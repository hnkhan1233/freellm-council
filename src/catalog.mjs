// Live catalog — queries every CONFIGURED provider's models endpoint in parallel,
// keeps the free ones, tags each by capability, and aggregates per-category counts.
// This is what powers the "how powerful is the council" report and (next) the
// task-aware model selection.
import './env.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, categorize, CATEGORIES, NON_CHAT, canonical } from './providers.mjs'

const CACHE_DIR = join(homedir(), '.claude', 'council')
const CACHE_FILE = join(CACHE_DIR, 'catalog.json')

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
    const seen = new Set()
    const models = p.pickModels(data)
      .filter((m) => !NON_CHAT.test(m.id))
      .filter((m) => { const c = canonical(m.id); if (seen.has(c)) return false; seen.add(c); return true })
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

// Build fresh AND write the cache. Used by `status` so running it also primes
// the council's cache.
export async function refreshCatalog() {
  const data = await buildCatalog()
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), data })) } catch { /* cache is best-effort */ }
  return data
}

// Return a cached catalog if it's fresh, else rebuild. The council uses this so
// it doesn't re-query all providers on every consult.
export async function getCatalog({ maxAgeMs = 1_800_000 } = {}) {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    if (raw?.at && Date.now() - raw.at < maxAgeMs && raw.data?.models?.length) return raw.data
  } catch { /* no/old cache → rebuild */ }
  return refreshCatalog()
}
