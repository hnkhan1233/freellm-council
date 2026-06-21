// council.mjs — the core engine.
//
// Understands the task, picks the MOST RELEVANT free models from the live
// multi-provider catalog, fans the question out to them in parallel (each routed
// to its own provider's endpoint + key), and returns their critiques. It does NOT
// decide anything — that's Claude's job. This is "go ask the right advisors and
// bring back what they said."
import './env.mjs'
import { PROVIDERS, canonical } from './providers.mjs'
import { getCatalog } from './catalog.mjs'
import { recordResults, penaltyFor } from './health.mjs'
import { buildContext } from './context.mjs'

// Provider lookup for routing (id -> {baseUrl, keyEnv}).
const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]))
// Tie-break order when the same model is offered by several providers (speed/reliability-ish).
const PROVIDER_PREF = ['cerebras', 'groq', 'mistral', 'openrouter', 'gemini']

// Fallback panel if the catalog can't be built (no keys / discovery down) — OpenRouter only.
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3-coder:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
]

// task_type (free text) -> ordered capability preferences.
const TASK_PROFILES = {
  code: ['coding', 'reasoning', 'general'],
  debug: ['coding', 'reasoning', 'general'],
  refactor: ['coding', 'reasoning', 'general'],
  architecture: ['reasoning', 'long-context', 'general'],
  design: ['reasoning', 'long-context', 'general'],
  security: ['reasoning', 'coding', 'general'],
  performance: ['reasoning', 'coding', 'general'],
  data: ['coding', 'reasoning', 'general'],
  sql: ['coding', 'reasoning', 'general'],
  math: ['math', 'reasoning', 'general'],
  algorithm: ['math', 'reasoning', 'coding', 'general'],
  writing: ['general', 'reasoning'],
  docs: ['general', 'reasoning'],
  ui: ['vision', 'coding', 'general'],
  vision: ['vision', 'general'],
  general: ['reasoning', 'coding', 'general'],
}
function profileFor(task) {
  const t = (task || 'general').toLowerCase()
  for (const k of Object.keys(TASK_PROFILES)) if (t.includes(k)) return TASK_PROFILES[k]
  return TASK_PROFILES.general
}

// task_type -> what the reviewers should prioritize (injected into the prompt so
// the selected models review with the right lens, not blind).
const TASK_FOCUS = {
  code: 'correctness, edge cases, and error handling',
  debug: 'the actual root cause and any incorrect assumptions',
  refactor: 'behavior preservation, regressions, and simpler approaches',
  architecture: 'scalability, coupling, failure modes, and simpler designs',
  design: 'coherence of the approach, edge cases, and simpler alternatives',
  security: 'auth/authz, injection, secrets handling, input validation, and timing/replay attacks',
  performance: 'algorithmic complexity, allocations, N+1 queries, and re-renders',
  data: 'schema/migration safety, data loss, and integrity',
  sql: 'injection, missing indexes, and incorrect joins/aggregations',
  math: 'correctness of the formula/algorithm and numerical edge cases',
  algorithm: 'correctness, complexity, and edge cases',
  writing: 'clarity, accuracy, and structure',
  docs: 'accuracy, completeness, and clarity',
  ui: 'usability, accessibility, and responsive/edge-state handling',
  vision: 'what is actually shown vs intended, and visual/UX issues',
  general: 'correctness, risks, and missing cases',
}
function focusFor(task) {
  const t = (task || 'general').toLowerCase()
  for (const k of Object.keys(TASK_FOCUS)) if (t.includes(k)) return TASK_FOCUS[k]
  return TASK_FOCUS.general
}

// Bias toward known-strong free reviewers; penalize tiny models.
const FAVORITES = /qwen3-coder|codestral|devstral|qwen3-?32b|qwen3\.6|llama-3\.3-70b|llama-4|nemotron|gpt-oss-120b|magistral|deepseek|glm-4|gemini-2.*(pro|flash)|mistral-large|mixtral|command-r/i
const TINY = /(^|[-/])(0\.\d+b|1b|1\.5b|2b|3b|4b)(\b|-|$)/i

function scoreModel(m, prefCats) {
  let s = 0
  prefCats.forEach((c, i) => { if (m.cats?.includes(c)) s += (prefCats.length - i) * 2 })
  if (FAVORITES.test(m.id)) s += 5
  if (TINY.test(m.id)) s -= 6
  if ((m.ctx || 0) >= 100_000) s += 1
  s -= penaltyFor(m.id) // deprioritize models that keep failing (learned over calls)
  return s
}

// Rank the catalog for a task: dedupe the same model across providers (keep the
// preferred provider), score by relevance, return the ranked unique list.
function rankModels(catalog, task) {
  const pref = profileFor(task)
  const byFamily = new Map()
  for (const m of catalog.models) {
    const fam = `${canonical(m.id)}`
    const s = scoreModel(m, pref)
    const cur = byFamily.get(fam)
    const better = !cur
      || s > cur.s
      || (s === cur.s && PROVIDER_PREF.indexOf(m.provider) < PROVIDER_PREF.indexOf(cur.m.provider))
    if (better) byFamily.set(fam, { m, s })
  }
  return [...byFamily.values()].sort((a, b) => b.s - a.s).map((e) => e.m)
}

// Pick `n` with provider diversity (≤2 per provider first, then relax).
function pickDiverse(ranked, n) {
  const picked = []; const seen = new Set(); const per = {}
  for (const m of ranked) {
    if (picked.length >= n) break
    if ((per[m.provider] || 0) >= 2) continue
    picked.push(m); seen.add(m.id); per[m.provider] = (per[m.provider] || 0) + 1
  }
  for (const m of ranked) { // relax cap if we couldn't fill n
    if (picked.length >= n) break
    if (!seen.has(m.id)) { picked.push(m); seen.add(m.id) }
  }
  return picked
}

const REVIEWER_SYSTEM = `You are an expert engineer on a review council. You are given a plan or code plus a question. \
Be a rigorous SKEPTIC OF YOUR OWN CONCERNS — false alarms are costly and waste the team's time:
- Only raise "concerns"/"reject" if you can point to something CONCRETE. For code, that means a SPECIFIC input that yields a wrong result — name the input and the wrong vs. expected output. For a plan, a specific scenario that breaks it. If you cannot produce a concrete counterexample, you must "approve".
- Judge ONLY against the stated spec/intent. Do NOT invent out-of-spec problems (inputs the spec excludes, validation it never asked for, "what if None", hypotheticals you can't demonstrate). Those are not bugs.
- If it is correct for the spec, say so plainly and approve. Approving correct work is the right answer, not a failure to find something.
- Be specific and brief (~200 words).
End with exactly two lines:
VERDICT: approve | concerns | reject
CONFIDENCE: low | medium | high`

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function route(providerId) {
  const p = PROVIDER_BY_ID[providerId]
  if (!p) return null
  const key = process.env[p.keyEnv]
  if (!key) return null
  return { baseUrl: p.baseUrl.replace(/\/$/, ''), key, id: p.id }
}

// One model call, routed to its provider, with retries on rate-limit / transient errors.
async function askModel(model, question, context, { signal, focus } = {}) {
  const r = route(model.provider)
  if (!r) return { ok: false, error: `no key for provider ${model.provider}` }
  const headers = { Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json' }
  if (r.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/freellm-council'; headers['X-Title'] = 'FreeLLM Council' }
  const focusLine = focus ? `REVIEW FOCUS: ${focus}. Prioritize this, but still flag any other serious issue.\n\n` : ''
  let lastErr = 'unknown'
  let ctxCap = Infinity // shrinks only if a model rejects the request as too large (size / TPM)
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctx = context.length > ctxCap ? context.slice(0, ctxCap) + '\n... [context truncated to fit this model]' : context
    const body = {
      model: model.id,
      messages: [
        { role: 'system', content: REVIEWER_SYSTEM },
        { role: 'user', content: `${focusLine}QUESTION:\n${question}\n\nCONTEXT:\n${ctx}` },
      ],
      temperature: 0.4,
      max_tokens: 2000, // headroom so verbose reasoning models still reach their VERDICT line
    }
    try {
      const res = await fetch(`${r.baseUrl}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after')) || 0
        lastErr = `HTTP ${res.status}`
        await sleep((ra ? ra * 1000 : 0) + 1500 * (attempt + 1)); continue
      }
      if (!res.ok) {
        const t = await res.text()
        // Too-large (per-request size or tokens-per-minute) → shrink context and retry, don't drop the model.
        if (res.status === 413 || /too large|context[_ ]length|maximum context|tokens per minute/i.test(t)) {
          ctxCap = ctxCap === Infinity ? 8000 : Math.max(2000, Math.floor(ctxCap / 2))
          lastErr = `HTTP ${res.status} (too large → retry with ${ctxCap} chars)`
          continue
        }
        return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 160)}` }
      }
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content?.trim()
      if (!text) { lastErr = 'empty response'; await sleep(1200); continue }
      return { ok: true, critique: text }
    } catch (e) {
      lastErr = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e)
      if (lastErr === 'timeout') break
      await sleep(1200 * (attempt + 1))
    }
  }
  return { ok: false, error: lastErr }
}

// Generic routed chat call to a single model (used by tooling/benchmarks that
// need a solver, not a reviewer). Returns { ok, text } or { ok:false, error }.
export async function chat(modelId, providerId, messages, { maxTokens = 1200, temperature = 0.2, timeoutMs = 60_000 } = {}) {
  const r = route(providerId)
  if (!r) return { ok: false, error: `no key for provider ${providerId}` }
  const headers = { Authorization: `Bearer ${r.key}`, 'Content-Type': 'application/json' }
  if (r.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/freellm-council'; headers['X-Title'] = 'FreeLLM Council' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (let a = 0; a < 3; a++) {
      const res = await fetch(`${r.baseUrl}/chat/completions`, {
        method: 'POST', signal: ctrl.signal, headers,
        body: JSON.stringify({ model: modelId, messages, temperature, max_tokens: maxTokens }),
      })
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (a + 1)); continue }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}` }
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content?.trim()
      return text ? { ok: true, text } : { ok: false, error: 'empty' }
    }
    return { ok: false, error: 'rate-limited' }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally { clearTimeout(timer) }
}

function parseVerdict(critique) {
  const t = critique.replace(/\*/g, '') // tolerate **VERDICT:** markdown bolding
  const v = /VERDICT:?\s*(approve|concerns|reject)/i.exec(t)?.[1]?.toLowerCase()
  const c = /CONFIDENCE:?\s*(low|medium|high)/i.exec(t)?.[1]?.toLowerCase()
  return { verdict: v || 'unknown', confidence: c || 'unknown' }
}

/**
 * Consult the council.
 * @param {object} o
 * @param {string} o.question      what to evaluate
 * @param {string} [o.context]     the plan/code/background to critique
 * @param {string} [o.task_type]   e.g. "code", "security", "architecture" — drives model selection
 * @param {string[]} [o.models]    explicit model-id override (skips task selection)
 * @param {number} [o.count]       panel size (default 4)
 * @param {number} [o.timeoutMs]   per-model timeout (default 90s)
 */
export async function consultCouncil({ question, context = '', plan, files, diff, cwd, task_type, models, count = 4, timeoutMs = 90_000 } = {}) {
  if (!question) throw new Error('A question is required.')

  // Assemble the context the council reviews: from a plan + real files + a git
  // diff if given, else use the raw context string verbatim.
  const effectiveContext = (plan || (files && files.length) || diff)
    ? buildContext({ plan, context, files, diff, cwd })
    : context
  const focus = focusFor(task_type)

  const catalog = await getCatalog().catch(() => null)
  let primary, pool = []
  let selection = { task_type: task_type || 'general', source: 'catalog' }

  if (models && models.length) {
    // Explicit override — resolve provider from the catalog, else assume OpenRouter.
    primary = models.map((id) => catalog?.models.find((m) => m.id === id) || { id, provider: 'openrouter', cats: [] })
    selection.source = 'explicit'
  } else if (catalog && catalog.models.length) {
    const ranked = rankModels(catalog, task_type)
    primary = pickDiverse(ranked, count)
    pool = ranked.filter((m) => !primary.includes(m)) // failover pool: next-best, unused
  } else {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('No providers configured. Add keys to .env and run `npm run status`.')
    primary = FALLBACK_MODELS.map((id) => ({ id, provider: 'openrouter', cats: [] }))
    selection.source = 'fallback'
  }

  const start = Date.now()
  const run = (m) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    return askModel(m, question, effectiveContext, { signal: ctrl.signal, focus })
      .then((r) => ({ model: m.id, provider: m.provider, ...r }))
      .finally(() => clearTimeout(timer))
  }

  let panel = await Promise.all(primary.map(run))

  // Top up from the next-best relevant models if too many failed (free models 429 a lot).
  const target = Math.min(3, primary.length)
  const okCount = () => panel.filter((p) => p.ok).length
  let pi = 0
  while (okCount() < target && pi < pool.length) {
    const fillers = pool.slice(pi, pi + (target - okCount())); pi += fillers.length
    if (!fillers.length) break
    panel = panel.concat(await Promise.all(fillers.map(run)))
  }

  panel = panel.map((p) => (p.ok ? { ...p, ...parseVerdict(p.critique) } : p))
  recordResults(panel) // learn which models answered vs failed, for future selection
  const ok = panel.filter((p) => p.ok)
  const tally = { approve: 0, concerns: 0, reject: 0, unknown: 0 }
  ok.forEach((p) => { tally[p.verdict] = (tally[p.verdict] || 0) + 1 })

  return {
    question,
    selection,
    elapsedMs: Date.now() - start,
    panel,
    stats: { asked: panel.length, answered: ok.length, failed: panel.length - ok.length, verdicts: tally },
  }
}
