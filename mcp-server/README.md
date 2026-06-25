# Just Contacts — MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
**Just Contacts** personal CRM ("second memory for your people") as standard agent
tools. Any MCP-capable client — Google **ADK** agents, **Claude**, **Gemini CLI**, or an
IDE like **Antigravity** — can capture, find, read and reason about the user's contacts.

It is a **thin protocol layer**: every tool reuses the *same* Genkit flows and vector
search pipeline that already power the production Telegram app (`src/ai/logic/*`,
`src/lib/vector.ts`). The intelligence isn't reimplemented — it's made portable.

## Tools

| Tool | Input | What it does |
|------|-------|--------------|
| `add_contact` | `text` | LLM extracts name/role/tags/phone/email + dossier from free text, de-dupes by phone, saves with search vectors. |
| `search_contacts` | `query` | Meaning-based search (self-query → embeddings → LLM relevance). Handles "designer I had lunch with". |
| `list_contacts` | `limit?` | Lists saved contacts (light fields) to obtain ids. |
| `get_contact` | `contactId` | Full contact + parsed dossier (recent summary + key facts). |
| `ask_about_contact` | `contactId`, `question` | Grounded Q&A about one person, answered only from their dossier + history. |

## Architecture

```
MCP client (ADK agent / Claude / Gemini CLI / Antigravity)
        │  stdio (JSON-RPC)
        ▼
mcp-server/server.ts        ← tool catalogue + input guardrails
        │
mcp-server/contacts-store.ts ← scoped to ONE user (MCP_USER_ID)
        │  reuses ↓
src/ai/logic/*  +  src/lib/vector.ts   ← the SAME pipeline the app ships
        │
Firebase Admin (Firestore)   users/{uid}/contacts/**
```

## Security

- **Single-user scope.** The server is hard-bound to `MCP_USER_ID`. Tool handlers never
  accept a user id from the model, so a prompt-injected agent cannot reach other users'
  data even though the server runs with privileged Admin credentials.
- **Input guardrails.** Length caps + empty-input rejection run before any tool logic.
- **No secrets in code.** Credentials come from `.env` only (`.env` is git-ignored).
- **stdio transport.** No network port is opened; the client spawns the process locally.

## Setup

```bash
npm install

# .env (copied from .env.example) must contain:
#   GEMINI_API_KEY=...                      # AI parsing/search/embeddings
#   FIREBASE_SERVICE_ACCOUNT_KEY={...}      # Firestore access (single line JSON)
#   MCP_USER_ID=tg_123456789                # the one user this server may touch

npm run mcp          # start the server (stdio)
npm run mcp:smoke    # protocol smoke test (lists tools; no Gemini/Firestore calls)
npm run mcp:inspect  # open the MCP Inspector UI
```

## Wiring it into a client

**Claude Desktop / any `mcpServers` config:**
```json
{
  "mcpServers": {
    "just-contacts": {
      "command": "npx",
      "args": ["tsx", "mcp-server/server.ts"],
      "cwd": "/absolute/path/to/just-contacts-capstone",
      "env": { "MCP_USER_ID": "tg_123456789" }
    }
  }
}
```

**Google ADK** consumes the same server via `MCPToolset` (stdio) — see `adk-agent/`.
