#!/usr/bin/env node
// PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit. Per-session: if council
// mode is ON for THIS session and the council hasn't been consulted this turn,
// BLOCK the edit (exit 2). Fails open if mode is off or already consulted.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let sid = 'default'
try { sid = JSON.parse(readFileSync(0, 'utf8')).session_id || 'default' } catch {}

const dir = join(homedir(), '.claude', 'council')
const modeFile = join(dir, `mode-${sid}`)
const consultedFile = join(dir, `consulted-${sid}`)

const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'off'
if (mode !== 'on') process.exit(0)             // council off → allow
if (existsSync(consultedFile)) process.exit(0) // consulted this turn → allow

process.stderr.write(
  'BLOCKED by council mode (ON for this session). You have not consulted the council this turn. '
  + 'Call the consult_council tool (mcp__council__consult_council) with this task and the relevant context/plan, '
  + 'weigh the critiques, THEN make the edit. This hook keeps blocking Write/Edit until a council consult runs '
  + 'this turn. (The user can say "council off" to disable.)',
)
process.exit(2)
