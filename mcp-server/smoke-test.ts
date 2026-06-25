/**
 * Smoke test for the MCP server: spawns it over stdio and lists its tools.
 * This validates protocol wiring, transport, and tool schemas WITHOUT calling
 * Gemini or Firestore (tools/list touches neither). Run: npm run mcp:smoke
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'mcp-server/server.ts'],
    // Dummy values so import-time checks pass; no live tool is called here.
    env: { ...process.env, MCP_USER_ID: 'smoke-test', GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'dummy' },
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`\n✅ Connected. Server advertises ${tools.length} tools:\n`);
  for (const t of tools) {
    const req = (t.inputSchema as any)?.required?.join(', ') || '—';
    console.log(`  • ${t.name}  (required: ${req})`);
  }

  await client.close();
  console.log('\n✅ MCP protocol smoke test passed.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ Smoke test failed:', e);
  process.exit(1);
});
