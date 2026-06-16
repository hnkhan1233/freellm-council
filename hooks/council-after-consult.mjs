#!/usr/bin/env node
// PostToolUse hook on mcp__council__consult_council. Records that the council was
// consulted this turn, which unlocks the edit gate. Fires regardless of whether
// the council fully answered (fail-open: a good-faith consult shouldn't leave the
// user unable to edit just because free models were rate-limited).
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.claude', 'council')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'consulted'), String(Date.now()))
process.exit(0)
