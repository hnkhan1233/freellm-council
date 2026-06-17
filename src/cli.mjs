#!/usr/bin/env node
// cli.mjs — run the council from a terminal. Handy for testing, and for anyone
// who wants critiques without Claude in the loop.
//
//   node src/cli.mjs -q "Any risks in this Stripe flow?" -f plan.md
//   echo "<code>" | node src/cli.mjs -q "Review this"
//   node src/cli.mjs -q "..." -c "inline context" --json

import { readFileSync } from 'node:fs'
import { consultCouncil } from './council.mjs'

function parseArgs(argv) {
  const o = { question: '', context: '', json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-q' || a === '--question') o.question = argv[++i]
    else if (a === '-c' || a === '--context') o.context = argv[++i]
    else if (a === '-f' || a === '--context-file') o.context = readFileSync(argv[++i], 'utf8')
    else if (a === '-t' || a === '--task') o.task_type = argv[++i]
    else if (a === '--models') o.models = argv[++i].split(',').map((s) => s.trim())
    else if (a === '--json') o.json = true
    else if (!o.question) o.question = a
  }
  return o
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const C = { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m` }
const verdictColor = (v) => (v === 'approve' ? C.g : v === 'reject' ? C.r : v === 'concerns' ? C.y : C.dim)

const args = parseArgs(process.argv.slice(2))
if (!args.context) args.context = await readStdin()
if (!args.question) {
  console.error('Usage: node src/cli.mjs -q "question" [-t task] [-f context-file | -c "context"] [--models a,b] [--json]')
  process.exit(1)
}

console.error(C.dim(`Consulting council on: ${args.question}`))
const result = await consultCouncil(args)

if (args.json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  const { panel, stats, elapsedMs, selection } = result
  console.log('\n' + C.b('═══ COUNCIL REPORT ') + C.dim(`(task: ${selection.task_type} · ${selection.source} · ${stats.answered}/${stats.asked} answered, ${(elapsedMs / 1000).toFixed(1)}s)`))
  for (const p of panel) {
    console.log('\n' + C.b('▸ ' + p.model) + C.dim(`  [${p.provider}]`))
    if (!p.ok) { console.log('  ' + C.r('✗ no response — ' + p.error)); continue }
    console.log('  ' + verdictColor(p.verdict)(`[${p.verdict.toUpperCase()} · ${p.confidence}]`))
    console.log(p.critique.split('\n').map((l) => '  ' + l).join('\n'))
  }
  const v = stats.verdicts
  console.log('\n' + C.b('─── tally: ') + `${C.g(v.approve + ' approve')} · ${C.y(v.concerns + ' concerns')} · ${C.r(v.reject + ' reject')}` + (v.unknown ? ` · ${v.unknown} unknown` : ''))
}
