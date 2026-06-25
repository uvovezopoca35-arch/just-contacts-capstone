/**
 * Live end-to-end test of the MCP server against real (seeded) Firestore data.
 * Unlike smoke-test.ts, this actually CALLS tools, so it exercises the full
 * stack: Firestore reads, embeddings backfill, and the Gemini ranking step.
 *
 * Requires a configured .env (FIREBASE_SERVICE_ACCOUNT_KEY, GEMINI_API_KEY,
 * MCP_USER_ID) and seeded data (`npm run seed`). Run: npm run mcp:live
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function textOf(res: any): string {
  return (res?.content || []).map((c: any) => c.text).join('\n');
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'mcp-server/server.ts'],
    env: { ...process.env } as Record<string, string>, // server self-loads .env too
  });
  const client = new Client({ name: 'live-test', version: '1.0.0' });
  await client.connect(transport);

  console.log('\n── list_contacts ─────────────────────────────');
  const list = await client.callTool({ name: 'list_contacts', arguments: { limit: 50 } });
  const contacts = JSON.parse(textOf(list));
  console.log(`Firestore read OK — ${contacts.length} contacts. First 3:`);
  contacts.slice(0, 3).forEach((c: any) => console.log(`  • ${c.name} — ${c.role}`));

  if (!contacts.length) throw new Error('list_contacts returned no contacts — did you run `npm run seed`?');

  console.log('\n── search_contacts("who works in design?") ───');
  // Gemini can return transient 503s under load; retry a few times before failing.
  let search: any = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    search = await client.callTool({ name: 'search_contacts', arguments: { query: 'who works in design?' } });
    if (!search.isError) break;
    const msg = textOf(search);
    const transient = /503|UNAVAILABLE|high demand|overloaded/i.test(msg);
    console.log(`  attempt ${attempt} failed${transient ? ' (transient)' : ''}: ${msg.slice(0, 120)}`);
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (search.isError) {
    await client.close();
    console.error('\n❌ search_contacts failed after retries (see message above).');
    process.exit(1);
  }
  console.log(textOf(search));

  await client.close();
  console.log('\n✅ Live end-to-end test passed (Firestore read + full search pipeline).\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ Live test failed:', e);
  process.exit(1);
});
