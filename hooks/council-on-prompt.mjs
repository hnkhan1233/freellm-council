#!/usr/bin/env node
// UserPromptSubmit hook. Deterministically toggles council mode from the user's
// message ("council on" / "council off") — no model involvement, so it can't be
// rationalized away. While ON, it resets the per-turn "consulted" marker so the
// gate requires a fresh council consult before any edit this turn.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.claude', 'council')
mkdirSync(dir, { recursive: true })
const modeFile = join(dir, 'mode')
const consultedFile = join(dir, 'consulted')

let raw = ''
try { raw = readFileSync(0, 'utf8') } catch {}
let prompt = ''
try { prompt = JSON.parse(raw).prompt || '' } catch { prompt = raw }
const p = ' ' + prompt.toLowerCase() + ' '

if (/\bcouncil\s+(is\s+)?off\b/.test(p) || /\bturn\s+(the\s+)?council\s+off\b/.test(p)) {
  writeFileSync(modeFile, 'off')
} else if (/\bcouncil\s+(is\s+)?on\b/.test(p) || /\bturn\s+(the\s+)?council\s+on\b/.test(p)) {
  writeFileSync(modeFile, 'on')
}

const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'off'

if (mode === 'on') {
  rmSync(consultedFile, { force: true }) // new turn → require a fresh consult
  console.log('[council mode: ON] You MUST call the consult_council tool (mcp__council__consult_council) with the task + relevant context before writing or editing any file this turn. File edits are hard-blocked by a hook until you do. Say "council off" to disable.')
}
process.exit(0)
