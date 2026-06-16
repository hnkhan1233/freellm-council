// End-to-end proof: spawn the MCP server exactly like a Claude session would,
// then actually CALL consult_council through the MCP protocol.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/mcp.mjs'],
  env: { ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
})

const client = new Client({ name: 'e2e-test', version: '0' }, { capabilities: {} })
await client.connect(transport)

const tools = await client.listTools()
console.log('TOOLS EXPOSED:', tools.tools.map((t) => t.name).join(', '))

console.log('CALLING consult_council (1 model, quick)...')
const res = await client.callTool(
  {
    name: 'consult_council',
    arguments: {
      question: 'Is using a plain string === comparison to check a user-supplied API key in Node safe?',
      context: 'if (req.headers.authorization === process.env.API_KEY) { /* allow */ }',
      models: ['nvidia/nemotron-3-super-120b-a12b:free'],
    },
  },
  undefined,
  { timeout: 120000 },
)

console.log('\n===== TOOL RESULT =====')
console.log(res.content?.[0]?.text || JSON.stringify(res))
await client.close()
process.exit(0)
