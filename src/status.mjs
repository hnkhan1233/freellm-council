#!/usr/bin/env node
// `council status` — shows how powerful your council is: which providers are lit,
// how many live free models you have across all of them, the per-capability
// breakdown, and which providers to add for more power.
import { refreshCatalog } from './catalog.mjs'
import { PROVIDERS, CATEGORIES } from './providers.mjs'

const C = { b: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m` }
const strength = (n) => (n >= 6 ? C.g('STRONG') : n >= 3 ? C.y('MODERATE') : n >= 1 ? C.r('WEAK') : C.dim('—'))
const bar = (n, max) => '█'.repeat(Math.round((n / Math.max(max, 1)) * 22)).padEnd(22, '·')

const cat = await refreshCatalog()

console.log('\n' + C.b('═══ COUNCIL ROSTER ') + C.dim(`(${cat.liveCount}/${PROVIDERS.length} providers lit · ${cat.total} live free models)`))

console.log('\n' + C.b('Providers'))
for (const p of cat.providers) {
  if (!p.configured) { console.log(`  ${C.dim('○ ' + p.label.padEnd(16))} ${C.dim('not set — ' + p.keyEnv)}  ${C.dim(p.note)}`); continue }
  if (!p.ok) { console.log(`  ${C.r('✗ ' + p.label.padEnd(16))} ${C.r(p.error)}`); continue }
  console.log(`  ${C.g('● ' + p.label.padEnd(16))} ${C.b(String(p.models.length).padStart(3))} free models`)
}

console.log('\n' + C.b('Power by capability'))
const max = Math.max(...Object.values(cat.byCategory), 1)
for (const c of CATEGORIES) {
  const n = cat.byCategory[c] || 0
  console.log(`  ${c.padEnd(13)} ${C.c(bar(n, max))} ${String(n).padStart(3)}  ${strength(n)}`)
}

const missing = cat.providers.filter((p) => !p.configured)
if (missing.length) {
  console.log('\n' + C.b('Add more power') + C.dim(' — set any of these keys, then re-run:'))
  for (const p of missing) console.log(`  ${C.y(p.keyEnv.padEnd(20))} ${p.label} ${C.dim('· ' + p.note)} ${C.dim(p.signup)}`)
}

console.log('\n' + C.dim('The council fans out to the most relevant of these per task. More lit providers = more diversity + fewer rate-limit misses.\n'))
