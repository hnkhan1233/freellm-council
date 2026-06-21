// Runs the council (task_type=code) over a set of {problem, solution} pairs IN
// PARALLEL, so reviewing N HumanEval attempts takes ~one consult's wall-time, not N.
// Writes critiques.json: { task_id: { answered, verdicts, critiques:[{model,provider,verdict,critique}] } }
import { readFileSync, writeFileSync } from 'node:fs'
import { consultCouncil } from '../src/council.mjs'

const problems = Object.fromEntries(
  readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map((l) => { const p = JSON.parse(l); return [p.task_id, p] }),
)
const solutions = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const outPath = process.argv[4] || 'bench/critiques.json'

const ids = Object.keys(solutions)
console.error(`Reviewing ${ids.length} solutions with the council (parallel)...`)

const results = await Promise.all(ids.map(async (tid) => {
  const p = problems[tid]
  const question = `Review this Python solution to a coding problem. Is it correct for ALL cases in the spec (including edge cases)? If there is any bug, name it precisely. If it is fully correct, say so.`
  const context = `PROBLEM (signature + docstring spec):\n${p.prompt}\n\nPROPOSED SOLUTION:\n${solutions[tid]}`
  try {
    const r = await consultCouncil({ question, context, task_type: 'code', count: 4 })
    const critiques = r.panel.filter((x) => x.ok).map((x) => ({ model: x.model, provider: x.provider, verdict: x.verdict, confidence: x.confidence, critique: x.critique }))
    return [tid, { answered: r.stats.answered, asked: r.stats.asked, verdicts: r.stats.verdicts, critiques }]
  } catch (e) {
    return [tid, { error: String(e.message || e), critiques: [] }]
  }
}))

writeFileSync(outPath, JSON.stringify(Object.fromEntries(results), null, 2))
console.error(`Wrote ${outPath}`)
for (const [tid, r] of results) {
  const v = r.verdicts || {}
  console.error(`  ${tid}: ${r.answered || 0}/${r.asked || 0} answered · approve ${v.approve || 0} / concerns ${v.concerns || 0} / reject ${v.reject || 0}`)
}
