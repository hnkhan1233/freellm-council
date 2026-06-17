#!/usr/bin/env node
// mcp.mjs — exposes the council as an MCP tool named `consult_council`.
//
// Once this server is registered with an MCP client (Claude Code, Cursor,
// Claude Desktop, ...), the client gains a `consult_council` tool. The client's
// model calls it with a question + context; this server runs the fan-out and
// returns the panel's critiques as text for the model to weigh.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { consultCouncil } from './council.mjs'

const server = new Server(
  { name: 'freellm-council', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOL = {
  name: 'consult_council',
  description:
    'Get a second opinion from a council of free LLMs. Fans the question + context out to several free models in '
    + 'parallel and returns their independent critiques (each with a verdict: approve/concerns/reject). '
    + 'Call this in two situations: (1) on-demand, before a consequential/risky/hard-to-reverse change '
    + '(security, money, migrations, architecture); and (2) whenever the user has turned "council mode" ON for the '
    + 'session — in that mode you MUST call this before producing ANY code, design, or plan, no matter how trivial '
    + 'or obvious the task seems (do not skip it for being "simple"). YOU still make the final decision; this only '
    + 'surfaces what the advisors flagged.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The specific decision or thing to evaluate, phrased as a question.',
      },
      context: {
        type: 'string',
        description: 'The plan, code, diff, and background the council needs. Include the salient parts — not the whole transcript.',
      },
      task_type: {
        type: 'string',
        description: 'What kind of task this is — drives which free models are selected. Use one of: code, debug, refactor, architecture, design, security, performance, data, sql, math, algorithm, writing, docs, ui, vision, general.',
      },
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: override selection with specific model ids.',
      },
    },
    required: ['question'],
  },
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL] }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'consult_council') {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] }
  }
  try {
    const { question, context = '', task_type, models } = req.params.arguments || {}
    const result = await consultCouncil({ question, context, task_type, models })

    const lines = [`# Council report — task: ${result.selection.task_type} · ${result.stats.answered}/${result.stats.asked} answered (${(result.elapsedMs / 1000).toFixed(1)}s)`, '']
    for (const p of result.panel) {
      if (!p.ok) { lines.push(`## ${p.model} _(${p.provider})_\n_no response — ${p.error}_\n`); continue }
      lines.push(`## ${p.model} _(${p.provider})_ — **${p.verdict}** (${p.confidence})`, p.critique, '')
    }
    const v = result.stats.verdicts
    lines.push(`---`, `Tally: ${v.approve} approve · ${v.concerns} concerns · ${v.reject} reject${v.unknown ? ` · ${v.unknown} unknown` : ''}`)

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Council failed: ${e.message}` }] }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('freellm-council MCP server running on stdio')
