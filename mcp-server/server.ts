/**
 * Just Contacts — MCP Server
 * ============================================================================
 * Exposes the personal-CRM "second memory" as a set of Model Context Protocol
 * tools, so ANY MCP-capable agent (Google ADK, Claude, Gemini CLI, an IDE like
 * Antigravity, ...) can capture, find, read and reason about the user's people.
 *
 * Design notes:
 * - The tools are a thin protocol layer over the SAME Genkit flows + vector
 *   pipeline that power the production Telegram app (see ./contacts-store.ts).
 * - Transport is stdio: the agent spawns this process and talks to it over
 *   stdin/stdout, which is the standard local MCP wiring (no open network port).
 * - Security: input guardrails (size caps, empty rejection) run before any tool
 *   logic, and every operation is hard-scoped to a single configured user
 *   (MCP_USER_ID) inside contacts-store.ts.
 *
 * Run:  npm run mcp           (loads .env for GEMINI/Firebase creds)
 */
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  addContact,
  searchContacts,
  listContacts,
  getContact,
  askAboutContact,
} from './contacts-store.js';

// ── Input guardrails ────────────────────────────────────────────────────────
// A defensive boundary between untrusted model output and our tool logic.
const MAX_TEXT = 2000; // contact description
const MAX_QUERY = 300; // search query / question
const MAX_ID = 128; // Firestore document id

/** Trim, enforce a hard length cap, and reject empty input. */
function guard(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`"${field}" must be a string`);
  const v = value.trim();
  if (!v) throw new Error(`"${field}" must not be empty`);
  return v.slice(0, max);
}

// ── Tool catalogue (advertised to the agent on connect) ─────────────────────
const TOOLS: Tool[] = [
  {
    name: 'add_contact',
    description:
      'Capture a new contact from free-form natural language (e.g. "Ivan from the AI conf, snowboards, works at Yandex, +7 999 123 45 67"). The AI extracts name, role, tags, phone, email and a dossier, then saves it. De-dupes by phone.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Everything you remember about the person, in plain language.' } },
      required: ['text'],
    },
  },
  {
    name: 'search_contacts',
    description:
      'Find people by MEANING, not just exact name. Handles fuzzy queries like "designer I had lunch with", "who loves mountains", "fixes cars". Returns the most relevant contacts.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Natural-language description of who you are looking for.' } },
      required: ['query'],
    },
  },
  {
    name: 'list_contacts',
    description: "List the user's saved contacts (light fields). Useful to get contact ids before reading or asking about one.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max contacts to return (default 50, max 200).' } },
    },
  },
  {
    name: 'get_contact',
    description: 'Read one contact in full: role, tags, phone, email, and the AI dossier (recent summary + key facts). Requires a contact id.',
    inputSchema: {
      type: 'object',
      properties: { contactId: { type: 'string', description: 'The contact id (from search_contacts or list_contacts).' } },
      required: ['contactId'],
    },
  },
  {
    name: 'ask_about_contact',
    description:
      'Ask a free-form question about a specific person ("where did we meet?", "what did I promise to send?"). Answered ONLY from that contact\'s stored dossier and interaction history — no guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The contact id to ask about.' },
        question: { type: 'string', description: 'The question, in any language.' },
      },
      required: ['contactId', 'question'],
    },
  },
];

// ── Server wiring ───────────────────────────────────────────────────────────
const server = new Server(
  { name: 'just-contacts', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'add_contact':
        result = await addContact(guard((args as any).text, MAX_TEXT, 'text'));
        break;
      case 'search_contacts':
        result = await searchContacts(guard((args as any).query, MAX_QUERY, 'query'));
        break;
      case 'list_contacts': {
        const limit = typeof (args as any).limit === 'number' ? (args as any).limit : 50;
        result = await listContacts(limit);
        break;
      }
      case 'get_contact':
        result = await getContact(guard((args as any).contactId, MAX_ID, 'contactId'));
        break;
      case 'ask_about_contact':
        result = await askAboutContact(
          guard((args as any).contactId, MAX_ID, 'contactId'),
          guard((args as any).question, MAX_QUERY, 'question'),
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    // Tool errors are returned to the agent (isError) rather than crashing the
    // transport, so the model can read the message and recover.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] tool "${name}" failed:`, message);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr — stdout is reserved for the MCP JSON-RPC stream.
  console.error('[mcp] just-contacts server ready (stdio).');
}

main().catch((e) => {
  console.error('[mcp] fatal:', e);
  process.exit(1);
});
