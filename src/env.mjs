// Minimal .env loader (no dependency). Loads KEY=value lines from the repo-root
// .env into process.env if not already set. Import this FIRST, before anything
// reads process.env. Keeps provider keys out of git (.env is gitignored) while
// letting the CLI + status work without exporting vars each time.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

try {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const txt = readFileSync(join(root, '.env'), 'utf8')
  for (const line of txt.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch { /* no .env — rely on the real environment */ }
