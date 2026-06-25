# Contacts Concierge — ADK Multi-Agent

A [Google ADK](https://google.github.io/adk-docs/) multi-agent system that turns
**Just Contacts** into a conversational "second memory for your people". It is the
English, login-free entry point for the project: a local web playground where you talk
to a concierge that captures, finds and recalls your contacts.

All tools come from the project's **MCP server** (`../mcp-server`), which the agents
launch over stdio. The agents reason and route; the MCP server (reusing the production
Genkit + vector pipeline) does the work.

## Architecture

```
                    ┌─────────────────────────────┐
   user  ───────▶   │  Concierge  (orchestrator)  │   gemini-2.5-flash
                    │  routes to a specialist     │
                    └───────┬─────────┬───────────┘
            delegates       │         │        │
        ┌───────────────────┘    ┌────┘   └────────────────┐
        ▼                        ▼                          ▼
 capture_agent            finder_agent               memory_agent      gemini-2.5-flash-lite
 add_contact         search/list/get_contact     get_contact/ask_about_contact
        └────────────┬───────────┴───────────────────────┘
                     ▼   (MCP, stdio)
            just-contacts MCP server  →  Genkit flows + vector search  →  Firestore
```

This is the whitepaper's **factory model**: an orchestrator that delegates to specialists,
each holding a narrow, least-privilege toolset. It also demonstrates **intelligent model
routing** — `flash` for the orchestrator's routing judgement, cheaper `flash-lite` for the
specialists.

## Course concepts demonstrated here
- **ADK multi-agent system** — orchestrator + 3 delegated specialists (`agent.py`).
- **MCP server** — tools consumed via ADK's `McpToolset` over stdio.
- **Security** — least-privilege `tool_filter` per agent; single-user data scope in the
  MCP server; no secrets in code.

## Setup & run

```bash
# 1. Python deps (from this folder)
python -m venv .venv
.venv\Scripts\activate          # Windows  (source .venv/bin/activate on mac/linux)
pip install -r requirements.txt

# 2. Credentials — put these in the repo-root .env (one .env for the whole project):
#    GOOGLE_API_KEY=...                    # the agent's Gemini calls
#    GEMINI_API_KEY=...                    # the MCP server's calls (parse/search/embed)
#    FIREBASE_SERVICE_ACCOUNT_KEY={...}    # Firestore access (single-line JSON)
#    MCP_USER_ID=tg_123456789             # the one user the agent may touch
#    GOOGLE_GENAI_USE_VERTEXAI=FALSE       # use Google AI Studio, not Vertex

# 3. Launch the playground (from this adk-agent/ folder)
adk web
# open the printed URL, pick "contacts_concierge", and chat:
#   "Save Alex from the AI conf, snowboards, works at Stripe, +1 415 555 0142"
#   "who works in design?"
#   "where did I meet Alex?"
```

> Node.js must be installed: the agents spawn the MCP server via `npx tsx mcp-server/server.ts`.
> Run `npm install` in the repo root once so `tsx` and the MCP SDK are available.

## Troubleshooting: transient Gemini 503 ("high demand")
Gemini can briefly return `503 UNAVAILABLE` under load. The MCP server retries its own
Gemini calls automatically; the ADK agents' reasoning calls are not wrapped, so a turn can
occasionally come back empty. If that happens while recording, just retry, or switch to a
more available model without code changes:
```bash
# repo-root .env
GEMINI_MODEL=googleai/gemini-2.0-flash   # MCP server (parse/search/embed)
# adk-agent/.env
ADK_ORCHESTRATOR_MODEL=gemini-2.0-flash
ADK_SPECIALIST_MODEL=gemini-2.0-flash
```

## Notes
- Each specialist spawns its own MCP server process (clean least-privilege separation).
  For a single shared process, give one `McpToolset` to the root agent instead.
- Human-in-the-loop: `McpToolset(..., require_confirmation=True)` can gate write tools like
  `add_contact` behind an explicit user confirmation — a natural next security guardrail.
