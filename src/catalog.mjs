// Live catalog — queries every CONFIGURED provider's models endpoint in parallel,
// keeps the free ones, tags each by capability, and aggregates per-category counts.
// This is what powers the "how powerful is the council" report and (next) the
// task-aware model selection.
import './env.mjs'
import { PROVIDERS, categorize, CATEGORIES, NON_CHAT } from './providers.mjs'

async function listProvider(p) {
  const key = process.env[p.keyEnv]
  if (!key) return { id: p.id, label: p.label, keyEnv: p.keyEnv, signup: p.signup, note: p.note, configured: false, ok: false, models: [] }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(p.baseUrl + p.modelsPath, {
      headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal,
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return { id: p.id, label: p.label, configured: true, ok: false, error: `HTTP ${res.status}`, models: [] }
    const data = await res.json()
    const models = p.pickModels(data)
      .filter((m) => !NON_CHAT.test(m.id))
      .map((m) => ({ ...m, provider: p.id, cats: categorize(m) }))
    return { id: p.id, label: p.label, configured: true, ok: true, models }
  } catch (e) {
    return { id: p.id, label: p.label, configured: true, ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e), models: [] }
  }
}

export async function buildCatalog() {
  const providers = await Promise.all(PROVIDERS.map(listProvider))
  const live = providers.filter((p) => p.ok)
  const all = live.flatMap((p) => p.models)

  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]))
  for (const m of all) for (const c of m.cats) byCategory[c] = (byCategory[c] || 0) + 1

  return {
    providers,
    configuredCount: providers.filter((p) => p.configured).length,
    liveCount: live.length,
    total: all.length,
    byCategory,
    models: all,
  }
}
