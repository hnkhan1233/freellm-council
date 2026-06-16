# freellm-council

A **council of free LLMs** for Claude (and any MCP client). Before doing something
consequential, Claude hands the plan/code to several free models at once, they
critique it in parallel, and the critiques come back so Claude can decide with a
second opinion in hand. You keep using your Claude subscription — the free models
are cheap extra advisors.

```
Claude ──▶ consult_council ──┬─▶ model A ─┐
                             ├─▶ model B ─┤  parallel critiques
                             ├─▶ model C ─┤  (best-of, with failover)
                             └─▶ model D ─┘
                                   │
                          digest ◀─┘  ──▶ Claude weighs it & decides
```

It does **not** decide for you. It surfaces risks, bugs, and better approaches;
the calling model makes the final call.

## Setup

```bash
git clone <repo> freellm-council && cd freellm-council
npm install                       # only needed for the MCP server
cp .env.example .env              # add your OpenRouter key
```

Get a free key at https://openrouter.ai/keys.

## Use it from the terminal (no Claude needed)

```bash
export OPENROUTER_API_KEY=sk-or-...
node src/cli.mjs -q "Any risks in this Stripe webhook flow?" -f plan.md
git diff | node src/cli.mjs -q "Review this diff for bugs"
```

## Use it inside Claude Code (the main point)

Register the MCP server once:

```bash
claude mcp add council \
  -e OPENROUTER_API_KEY=sk-or-... \
  -- node /absolute/path/to/freellm-council/src/mcp.mjs
```

Restart Claude Code. You (and Claude) now have a `consult_council` tool. Say
*"ask the council first"*, or add this to your project's `CLAUDE.md` to make it
semi-automatic:

> Before implementing anything consequential (security, money, migrations,
> irreversible changes), call `consult_council` with the plan and relevant code,
> then weigh the critiques before acting.

Because MCP is a standard, the same server also works in Cursor, Claude Desktop,
and other MCP clients.

## Hard enforcement (optional)

The CLAUDE.md rule is soft (instruction-following). For a guarantee that nothing
gets built while council mode is ON without a consult first, wire the hooks in
`hooks/` into `~/.claude/settings.json`:

- `council-on-prompt.mjs` → **UserPromptSubmit** — flips mode on/off from your
  message ("council on" / "council off") and resets the per-turn consult marker.
- `council-gate-edit.mjs` → **PreToolUse** (matcher `Write|Edit|MultiEdit|NotebookEdit`)
  — blocks edits (exit 2) while ON until the council has been consulted this turn.
- `council-after-consult.mjs` → **PostToolUse** (matcher `mcp__council__consult_council`)
  — records the consult, unlocking the gate.

State is **per session** — keyed by `session_id` in `~/.claude/council/`
(`mode-<id>`, `consulted-<id>`). Turning it on in one session does NOT affect
others, and every new session starts OFF. The toggle only fires when your whole
message is the command ("council on" / "council off"), so mentioning the phrase
in a sentence won't flip it. Hooks load at session start — restart or open
`/hooks` after wiring them. (Note: file writes via the Bash tool are not gated;
the gate covers the Write/Edit family.)

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Your free key (required). |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` | Point at any OpenAI-compatible endpoint — e.g. a [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) gateway for more providers + failover. |
| `COUNCIL_MODELS` | 4 diverse free models | Comma-separated model ids to override the panel. |

## Notes

- **Free models rate-limit.** The council fires 4 in parallel and tops up from a
  backup pool if some 429, so you still get a useful panel. For heavy use, route
  through a multi-provider gateway via `OPENAI_BASE_URL`.
- **Your key stays local** — read from env at runtime, never stored or sent
  anywhere but the LLM endpoint. No telemetry.

MIT.
