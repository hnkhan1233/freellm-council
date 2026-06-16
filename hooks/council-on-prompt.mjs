#!/usr/bin/env node
// UserPromptSubmit hook. Toggles council mode for THIS SESSION ONLY (state keyed
// by session_id) from the user's message — deterministic, no model involvement.
// Only toggles when the message IS the command (e.g. "council on"), not when the
// phrase merely appears inside a sentence/question. While ON, resets the per-turn
// "consulted" marker so the gate requires a fresh council consult this turn.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let raw = ''
try { raw = readFileSync(0, 'utf8') } catch {}
let prompt = '', sid = 'default'
try { const j = JSON.parse(raw); prompt = j.prompt || ''; sid = j.session_id || 'default' } catch { prompt = raw }

const dir = join(homedir(), '.claude', 'council')
mkdirSync(dir, { recursive: true })
const modeFile = join(dir, `mode-${sid}`)
const consultedFile = join(dir, `consulted-${sid}`)

// Normalize: lowercase, trim, drop trailing punctuation, collapse whitespace.
const norm = prompt.toLowerCase().trim().replace(/[.!?,;:'"]+$/, '').replace(/\s+/g, ' ').trim()
// Toggle ONLY when the whole message is the command — so a question that merely
// contains "turn the council on" does not flip it.
const m = /^(turn\s+(the\s+)?)?council(\s+mode)?\s+(on|off)(\s+please)?$/.exec(norm)
if (m) {
  if (m[4] === 'off') rmSync(modeFile, { force: true })
  else writeFileSync(modeFile, 'on')
}

const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'off'
if (mode === 'on') {
  rmSync(consultedFile, { force: true }) // new turn → require a fresh consult
  console.log('[council mode: ON — this session] You MUST call the consult_council tool (mcp__council__consult_council) with the task + relevant context before writing or editing any file this turn. File edits are hard-blocked by a hook until you do. Say "council off" to disable.')
}
process.exit(0)
