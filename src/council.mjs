// council.mjs — the core engine.
//
// Takes a question + context, fans it out to several free LLMs IN PARALLEL,
// collects each one's critique, and returns a structured result. It does NOT
// decide anything — that's Claude's job. This is purely "go ask the advisors
// and bring back what they said."
//
// Transport is any OpenAI-compatible endpoint. Default is OpenRouter (one key,
// many free models). To route through a gateway like FreeLLMAPI instead, set
// OPENAI_BASE_URL to that gateway's /v1 URL — no code change needed.

const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || ''

// Four diverse, capable free models (different families => diverse opinions).
// Verified present on OpenRouter's free tier. Override with COUNCIL_MODELS.
export const DEFAULT_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3-coder:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
]

// Drawn from if a primary model fails (rate limit / down), to keep the panel full.
export const BACKUP_MODELS = [
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
]

const REVIEWER_SYSTEM = `You are an expert engineer serving on a review council. \
Another engineer hands you their plan or code plus a question. Give a SHARP, CONCRETE critique:
- Real bugs, risks, security holes, or missing cases — be specific, name the thing.
- Anything wrong with the approach, and a better one if you have it.
- Skip praise and generic advice. Brevity beats completeness; ~200 words max.
End with exactly two lines:
VERDICT: approve | concerns | reject
CONFIDENCE: low | medium | high`

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// One model call, with a couple of retries on rate-limit / transient errors.
async function askModel(model, question, context, { signal } = {}) {
  const body = {
    model,
    messages: [
      { role: 'system', content: REVIEWER_SYSTEM },
      { role: 'user', content: `QUESTION:\n${question}\n\nCONTEXT:\n${context}` },
    ],
    temperature: 0.4,
    max_tokens: 900,
  }
  let lastErr = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/freellm-council',
          'X-Title': 'FreeLLM Council',
        },
        body: JSON.stringify(body),
      })
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after')) || 0
        lastErr = `HTTP ${res.status}`
        await sleep((ra ? ra * 1000 : 0) + 1500 * (attempt + 1))
        continue
      }
      if (!res.ok) {
        const t = await res.text()
        return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 160)}` }
      }
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content?.trim()
      if (!text) { lastErr = 'empty response'; await sleep(1200); continue }
      return { ok: true, critique: text, usedModel: data?.model || model }
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e)
      if (lastErr === 'timeout') break
      await sleep(1200 * (attempt + 1))
    }
  }
  return { ok: false, error: lastErr }
}

function parseVerdict(critique) {
  const v = /VERDICT:\s*(approve|concerns|reject)/i.exec(critique)?.[1]?.toLowerCase()
  const c = /CONFIDENCE:\s*(low|medium|high)/i.exec(critique)?.[1]?.toLowerCase()
  return { verdict: v || 'unknown', confidence: c || 'unknown' }
}

/**
 * Consult the council.
 * @param {object} o
 * @param {string} o.question  what to evaluate
 * @param {string} o.context   the plan/code/background to critique
 * @param {string[]} [o.models]
 * @param {number} [o.timeoutMs]  per-model timeout (default 90s)
 * @returns {Promise<{question, elapsedMs, panel: Array, stats: object}>}
 */
export async function consultCouncil({ question, context = '', models, timeoutMs = 90000 } = {}) {
  if (!API_KEY) throw new Error('No API key. Set OPENROUTER_API_KEY (or OPENAI_API_KEY).')
  if (!question) throw new Error('A question is required.')

  const primary = models
    || (process.env.COUNCIL_MODELS ? process.env.COUNCIL_MODELS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_MODELS)

  const start = Date.now()
  const run = (m) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    return askModel(m, question, context, { signal: ctrl.signal })
      .then((r) => ({ model: m, ...r }))
      .finally(() => clearTimeout(timer))
  }

  let panel = await Promise.all(primary.map(run))

  // Top up from the backup pool until we have a useful panel. Free models 429
  // often, so aim for at least `target` real answers before giving up.
  const target = Math.min(3, primary.length)
  const okCount = () => panel.filter((p) => p.ok).length
  let guard = 0
  while (okCount() < target && guard++ < BACKUP_MODELS.length) {
    const tried = new Set(panel.map((p) => p.model))
    const fillers = BACKUP_MODELS.filter((m) => !tried.has(m)).slice(0, target - okCount())
    if (!fillers.length) break
    panel = panel.concat(await Promise.all(fillers.map(run)))
  }

  panel = panel.map((p) => (p.ok ? { ...p, ...parseVerdict(p.critique) } : p))

  const ok = panel.filter((p) => p.ok)
  const tally = { approve: 0, concerns: 0, reject: 0, unknown: 0 }
  ok.forEach((p) => { tally[p.verdict] = (tally[p.verdict] || 0) + 1 })

  return {
    question,
    elapsedMs: Date.now() - start,
    panel,
    stats: { asked: panel.length, answered: ok.length, failed: panel.length - ok.length, verdicts: tally },
  }
}
