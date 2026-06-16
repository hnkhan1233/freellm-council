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
    'Get a second opinion from a council of free LLMs before acting on a consequential decision. '
    + 'Fans the question + context out to several free models in parallel and returns their independent critiques '
    + '(each with a verdict: approve/concerns/reject). Use this before implementing risky, costly, or hard-to-reverse '
    + 'changes (security, money, data migrations, architecture, irreversible deletes) or when you want adversarial review '
    + 'of a plan. YOU make the final decision — this only surfaces what the advisors flagged.',
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
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: override the panel with specific OpenRouter model ids.',
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
    const { question, context = '', models } = req.params.arguments || {}
    const result = await consultCouncil({ question, context, models })

    const lines = [`# Council report — ${result.stats.answered}/${result.stats.asked} answered (${(result.elapsedMs / 1000).toFixed(1)}s)`, '']
    for (const p of result.panel) {
      if (!p.ok) { lines.push(`## ${p.model}\n_no response — ${p.error}_\n`); continue }
      lines.push(`## ${p.model} — **${p.verdict}** (${p.confidence})`, p.critique, '')
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
