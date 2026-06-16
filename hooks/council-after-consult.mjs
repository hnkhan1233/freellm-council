#!/usr/bin/env node
// PostToolUse hook on mcp__council__consult_council. Per-session: records that the
// council was consulted this turn (marker keyed by session_id), unlocking the edit
// gate. Fires regardless of whether the council fully answered (fail-open).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let sid = 'default'
try { sid = JSON.parse(readFileSync(0, 'utf8')).session_id || 'default' } catch {}

const dir = join(homedir(), '.claude', 'council')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, `consulted-${sid}`), String(Date.now()))
process.exit(0)
