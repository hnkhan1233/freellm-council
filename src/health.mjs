// Model health — learns which models keep failing (429 / timeout / errors) and
// lets the selector deprioritize them, so the council stops wasting slots and
// ~90s waits on models that never answer. Persisted at ~/.claude/council/health.json.
// Models recover: after a quiet period a benched model gets another chance.
import './env.mjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.claude', 'council')
const FILE = join(DIR, 'health.json')
const COOLDOWN_MS = 30 * 60 * 1000 // idle this long → reset the streak, give it another shot

let cache = null
function load() {
  if (cache) return cache
  try { cache = JSON.parse(readFileSync(FILE, 'utf8')) } catch { cache = {} }
  return cache
}

// Record the outcome of a council round (panel entries each have .model + .ok).
export function recordResults(panel) {
  const h = load()
  const now = Date.now()
  for (const p of panel) {
    if (!p.model) continue
    const e = h[p.model] || { ok: 0, fail: 0, consec: 0, lastTs: 0 }
    if (p.ok) { e.ok++; e.consec = 0 } else { e.fail++; e.consec++ }
    e.lastTs = now
    h[p.model] = e
  }
  cache = h
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(h)) } catch { /* best-effort */ }
}

// Selection penalty (subtracted from a model's relevance score). Higher = more
// deprioritized. A model with 3+ consecutive recent failures is effectively benched.
export function penaltyFor(modelId) {
  const e = load()[modelId]
  if (!e) return 0
  const stale = Date.now() - (e.lastTs || 0) > COOLDOWN_MS
  const consec = stale ? 0 : e.consec
  if (consec >= 3) return 100 // benched — sinks below every healthy model
  if (consec === 2) return 20
  const total = e.ok + e.fail
  if (total >= 4 && e.fail / total > 0.6) return 12 // chronically flaky
  return 0
}
