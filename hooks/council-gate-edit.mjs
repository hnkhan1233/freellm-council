#!/usr/bin/env node
// PreToolUse hook on Write|Edit|MultiEdit|NotebookEdit. If council mode is ON
// and the council has NOT been consulted this turn, BLOCK the edit (exit 2) and
// tell the model to consult first. Fails open if mode is off or already consulted.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.claude', 'council')
const modeFile = join(dir, 'mode')
const consultedFile = join(dir, 'consulted')

const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'off'

if (mode !== 'on') process.exit(0)             // council off → allow
if (existsSync(consultedFile)) process.exit(0) // consulted this turn → allow

process.stderr.write(
  'BLOCKED by council mode (ON). You have not consulted the council this turn. '
  + 'Call the consult_council tool (mcp__council__consult_council) with this task and the relevant context/plan, '
  + 'weigh the critiques, THEN make the edit. This hook will keep blocking Write/Edit until a council consult runs '
  + 'this turn. (To disable entirely, the user can say "council off".)',
)
process.exit(2) // non-zero with stderr → PreToolUse blocks the tool and shows this to the model
