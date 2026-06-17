// Context builder — assembles the `context` the council reviews from structured
// inputs (a plan, real files on disk, a git diff) instead of relying on the caller
// to hand-paste. Reads files with line numbers (so reviewers can cite locations)
// and caps total size so a big diff/file can't blow the request.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const DEFAULT_MAX = 120_000 // ~30k tokens — generous for free models, bounded

function numbered(txt) {
  return txt.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n')
}

/**
 * @param {object} o
 * @param {string} [o.plan]     the proposed approach to critique
 * @param {string} [o.context]  any extra raw context to include verbatim
 * @param {string[]} [o.files]  paths to read (relative to cwd or absolute)
 * @param {string|boolean} [o.diff] git diff to include — true = working tree, or a ref/range ("HEAD~1", "--staged", "main...")
 * @param {string} [o.cwd]      base dir for file paths + git (default process.cwd())
 * @param {number} [o.maxChars] overall size cap
 */
export function buildContext({ plan = '', context = '', files = [], diff, cwd = process.cwd(), maxChars = DEFAULT_MAX } = {}) {
  const parts = []
  if (plan) parts.push(`PROPOSED PLAN:\n${plan}`)
  if (context) parts.push(context)

  const perFile = Math.max(4000, Math.floor(maxChars / Math.max(files.length, 1)))
  for (const f of files) {
    try {
      let txt = readFileSync(resolve(cwd, f), 'utf8')
      let truncated = false
      if (txt.length > perFile) { txt = txt.slice(0, perFile); truncated = true }
      parts.push(`===== FILE: ${f} =====\n${numbered(txt)}${truncated ? '\n... [file truncated]' : ''}`)
    } catch (e) {
      parts.push(`===== FILE: ${f} (could not read: ${e.message}) =====`)
    }
  }

  if (diff) {
    try {
      const args = ['diff', '--no-color']
      if (typeof diff === 'string' && diff && diff !== 'true' && diff !== 'working') args.push(...diff.split(/\s+/))
      const label = args.length > 2 ? args.slice(2).join(' ') : 'working tree'
      let patch = execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
      if (patch.length > maxChars) patch = patch.slice(0, maxChars) + '\n... [diff truncated]'
      parts.push(patch.trim() ? `===== GIT DIFF (${label}) =====\n${patch}` : '===== GIT DIFF: no changes =====')
    } catch (e) {
      parts.push(`===== GIT DIFF (failed: ${String(e.message).split('\n')[0]}) =====`)
    }
  }

  let out = parts.join('\n\n')
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n... [context truncated to fit]'
  return out
}
