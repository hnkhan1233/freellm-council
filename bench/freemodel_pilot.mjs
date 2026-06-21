// "Is improvement possible?" experiment. A FREE MODEL solves HumanEval (so there's
// real headroom), then the council critiques (improved prompt), then the SAME model
// revises with the feedback. We score solo vs revised pass@1 — the council's lift.
// Also re-checks false positives on the 8 known-correct Claude solutions.
import { readFileSync, writeFileSync } from 'node:fs'
import { chat, consultCouncil } from '../src/council.mjs'

const SOLVER_ID = process.env.SOLVER_ID || 'llama-3.3-70b-versatile'
const SOLVER_PROV = process.env.SOLVER_PROV || 'groq'

const problems = readFileSync('bench/pilot2.jsonl', 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const extractCode = (t) => { const m = t.match(/```(?:python)?\s*([\s\S]*?)```/i); return ((m ? m[1] : t).trim()) + '\n' }

async function solve(p) {
  const r = await chat(SOLVER_ID, SOLVER_PROV, [{ role: 'user', content:
    `Complete this Python function so it satisfies its docstring. Return ONLY the complete function (with any needed imports) in one \`\`\`python block, no prose.\n\n${p.prompt}` }], { maxTokens: 1200 })
  return r.ok ? extractCode(r.text) : `def ${p.entry_point}(*a, **k):\n    raise Exception('solver failed: ${r.error}')\n`
}

async function review(p, sol) {
  try {
    const r = await consultCouncil({
      question: 'Review this Python solution. Only raise a concern if you can name a concrete input within the spec where it gives a wrong answer. Is it correct for the spec?',
      context: `PROBLEM:\n${p.prompt}\n\nSOLUTION:\n${sol}`, task_type: 'code', count: 4,
    })
    return { verdicts: r.stats.verdicts, critiques: r.panel.filter((x) => x.ok).map((x) => ({ model: x.model, verdict: x.verdict, critique: x.critique })) }
  } catch (e) { return { error: String(e.message || e), critiques: [] } }
}

async function revise(p, sol, crit) {
  const fb = (crit?.critiques || []).map((c) => `- [${c.verdict}] ${c.critique}`).join('\n') || '(no actionable feedback)'
  const r = await chat(SOLVER_ID, SOLVER_PROV, [{ role: 'user', content:
    `A reviewer panel critiqued your solution. Produce a CORRECTED complete function (only one \`\`\`python block). If a critique is wrong or out-of-spec, ignore it and keep the correct code.\n\nPROBLEM:\n${p.prompt}\n\nYOUR SOLUTION:\n${sol}\n\nPANEL FEEDBACK:\n${fb}` }], { maxTokens: 1200 })
  return r.ok ? extractCode(r.text) : sol
}

console.error(`solver = ${SOLVER_ID}@${SOLVER_PROV}\n[1/4] solving (solo)...`)
const solo = {}
await Promise.all(problems.map(async (p) => { solo[p.task_id] = await solve(p) }))
writeFileSync('bench/solutions_solo.json', JSON.stringify(solo, null, 2))

console.error('[2/4] council reviewing...')
const crit = {}
await Promise.all(problems.map(async (p) => { crit[p.task_id] = await review(p, solo[p.task_id]) }))
writeFileSync('bench/critiques_solo.json', JSON.stringify(crit, null, 2))

console.error('[3/4] revising with feedback...')
const rev = {}
await Promise.all(problems.map(async (p) => { rev[p.task_id] = await revise(p, solo[p.task_id], crit[p.task_id]) }))
writeFileSync('bench/solutions_revise.json', JSON.stringify(rev, null, 2))

console.error('[4/4] false-positive re-check on the 8 known-correct Claude solutions (improved prompt)...')
const A = JSON.parse(readFileSync('bench/solutions_A.json', 'utf8'))
const Ap = Object.fromEntries(readFileSync('bench/pilot.jsonl', 'utf8').trim().split('\n').map((l) => { const p = JSON.parse(l); return [p.task_id, p] }))
const fp = {}
await Promise.all(Object.keys(A).map(async (tid) => { fp[tid] = (await review(Ap[tid], A[tid])).verdicts || { error: 1 } }))
writeFileSync('bench/fp_recheck.json', JSON.stringify(fp, null, 2))
let app = 0, con = 0
for (const tid in fp) { app += fp[tid].approve || 0; con += fp[tid].concerns || 0 }
console.error(`FP re-check (improved prompt) on 8 CORRECT solutions: approve ${app} / concerns ${con}  (was: approve 8 / concerns 15 with the old prompt)`)
console.error('done — score solutions_solo.json vs solutions_revise.json')
