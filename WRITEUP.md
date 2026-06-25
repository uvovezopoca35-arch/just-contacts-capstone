<!--
  Kaggle Writeup — copy this into the Kaggle "New Writeup" editor.
  Track: Concierge Agents. Target: < 2500 words (this draft ≈ 1,750).
  Replace the <!-- TODO --> links before submitting.
-->

# Just Contacts — a second memory for the people you meet

### A Concierge agent that turns one sentence into a living contact — built on a Model Context Protocol server and a Google ADK multi-agent, on top of a real, deployed product.

**Track:** Concierge Agents
**Live product:** <!-- TODO: Telegram bot link --> · **Code:** https://github.com/uvovezopoca35-arch/just-contacts-capstone · **Video:** <!-- TODO: YouTube -->

---

## The problem

We meet people constantly — at conferences, online, at work — and then we forget them. An ordinary phone contact stores a *number*; it remembers nothing about the *person*: where you met, what they do, what you promised to send them. Business cards die in a drawer, names fade within a week, and warm connections quietly go cold.

The information isn't hard to capture — it's trapped behind data entry nobody wants to do. People will happily *say* "Alex from the AI conference, works at Stripe, snowboards, +1 415 555 0142," but they will not fill in eight form fields for it. That friction is why every contacts app eventually goes stale.

## The solution

**Just Contacts** removes the friction by letting you talk while the AI does the structuring. You describe a person in one messy sentence (or forward a contact, or snap a business card) and an LLM extracts the name, role, tags, phone, email and a short *dossier*. Later you find people the way you actually remember them — *"who works in design?"*, *"the designer I had lunch with"*, *"who fixes cars"* — and you can ask grounded questions about anyone (*"where did we meet?"*) answered only from their saved history.

It already ships as a **deployed Telegram Mini App + bot** with a real backend. For this capstone I extended it with a portable **agent layer** — a **Model Context Protocol (MCP) server** and a **Google ADK multi-agent** — so the same intelligence can be driven by any agent runtime and experienced as a conversational concierge.

## Why agents (and not just an app)

The core task is genuinely *agentic* in the sense the course defines: perceive a goal, plan, act through tools, observe, and iterate — not a single prompt-and-response.

- **Capture** needs structured extraction with rules: don't invent facts, de-duplicate by phone, keep the dossier to durable traits (who the person *is*) rather than one-off plans.
- **Recall** needs a *pipeline*, not one call: separate hard logical constraints from meaning, embed, pre-rank by vectors, then let a model make the final relevance judgement.
- **Conversation** needs *delegation*: a router that decides whether the user wants to *save*, *find*, or *ask about* someone, and hands the task to a specialist.

A single model trying to do all of this at once is brittle. An orchestrator that reasons about intent and calls the right tool is the natural fit — which is exactly what the ADK + MCP layer provides.

## Architecture

Two entry points — the deployed Telegram product and the capstone ADK concierge — drive **one shared core**: the Genkit flows and the vector search pipeline. The MCP server does **not** reimplement any intelligence; it makes the existing, production-tested core callable by any agent.

```
Telegram Mini App + bot ─┐
                         ├─▶  Shared core (Genkit flows + vector pipeline) ─▶ Gemini + Firestore
ADK concierge ─▶ MCP ────┘
```

**Shared core.** Pure AI logic lives in `src/ai/logic/*` (importable by the app, the bot, and the MCP server); thin `'use server'` wrappers add auth and rate-limiting. Vector math is I/O-free in `src/lib/vector.ts`. This separation is what makes the same logic reusable across three surfaces without duplication.

**The MCP server** (`mcp-server/`) exposes five tools over stdio — `add_contact`, `search_contacts`, `list_contacts`, `get_contact`, `ask_about_contact` — each a thin wrapper over the same flows the product uses. A contact created by an agent is byte-for-byte identical to one a human creates in the app.

**The ADK multi-agent** (`adk-agent/`) follows the whitepaper's *factory model*: a **Concierge orchestrator** that delegates to three specialists, each holding a narrow, least-privilege slice of the MCP toolset.

| Agent | Model | Tools | Role |
|------|-------|-------|------|
| Concierge (orchestrator) | gemini-2.5-flash | — | Routes the request |
| capture_agent | gemini-2.5-flash-lite | `add_contact` | Save a new person |
| finder_agent | gemini-2.5-flash-lite | `search_contacts`, `list_contacts`, `get_contact` | Find / open people |
| memory_agent | gemini-2.5-flash-lite | `get_contact`, `ask_about_contact` | Answer about one person |

This applies two course ideas deliberately: **tool access via MCP** (vendor-agnostic — the same server works for ADK, Claude, or the Gemini CLI), and **intelligent model routing** (a stronger model for the orchestrator's routing judgement, a cheaper one for the specialists).

**How search actually works.** `search_contacts` reproduces the production pipeline rather than doing a naive vector lookup:
1. **Self-query** — split the query into a semantic part plus hard logical filters (exclusions, a birthday month) that embeddings can't express.
2. **Embed** the query with `gemini-embedding-001` (256-dim, task-typed for retrieval).
3. **Candidate set** = adaptive top-k by cosine similarity over per-fact **int8 multi-vectors** (each dossier fact gets its own vector, so a pointed detail isn't averaged away) ∪ keyword matches the embedding might miss.
4. **LLM relevance** ranks only that small candidate set, so token cost stays flat no matter how many contacts a user has.

## The six course concepts — and where they live

This submission demonstrates all six, not the minimum three:

| Concept | Where |
|---------|-------|
| **Agent / multi-agent (ADK)** | `adk-agent/contacts_concierge/agent.py` — orchestrator + 3 delegated specialists |
| **MCP server** | `mcp-server/server.ts` + `contacts-store.ts` — 5 tools over stdio |
| **Antigravity** | The whole project was built and iterated in the Antigravity IDE |
| **Security features** | `firestore.rules`, server-side auth, rate limiting, single-user MCP scope, input guardrails |
| **Deployability** | Deployed on Vercel / Firebase App Hosting; ADK is deployable to Agent Engine |
| **Agent skills** | `.agents/skills/` + `skills-lock.json` (Firebase agent-skills) |

## Engineering for trust (the Concierge angle)

Because a concierge handles personal data, security is enforced in code, not by hope:

- **Path-based ownership** (`firestore.rules`): a user can only touch `users/{their-uid}/**`; ownership fields are immutable after creation; internal collections are server-only.
- **The MCP server is hard-scoped to a single user** via `MCP_USER_ID`. Tool handlers never accept a user id from the model, so a prompt-injected agent cannot reach another user's data even though the server runs with privileged credentials. Each ADK specialist additionally sees only the tools it needs (least privilege).
- **Input guardrails** (length caps, empty-input rejection) run before any tool logic.
- **Resilience:** every Gemini call is wrapped in a `withRetry` helper with exponential backoff, so transient model 503/429 spikes are retried instead of surfacing to users as failures.
- **No secrets in code:** all keys come from environment variables; the Firebase web config is loaded from env and verified by secret scanning.

## The build

I built this in the **Antigravity** agent-first IDE, in the spirit of the course — describing intent and reviewing output rather than typing boilerplate. The stack:

- **App:** Next.js 15 (App Router, RSC, server actions), TypeScript, Tailwind, Radix UI; Telegram Mini App.
- **AI:** Genkit + Gemini (`gemini-2.5-flash-lite` for reasoning, `gemini-embedding-001` for retrieval).
- **Agents:** Google ADK (multi-agent + `MCPToolset`) and the Model Context Protocol TypeScript SDK.
- **Backend:** Firebase — Firestore, Auth (Telegram custom tokens), App Hosting.

A key architectural decision was to **not rebuild the product as a demo**. The strongest proof an agent is useful is that it sits on top of something real. So I kept the deployed Telegram product as the credibility anchor and added the MCP + ADK layer as a *thin, reusable surface* over the exact same logic. This is also the most honest engineering: the agent's `add_contact` and the app's "add contact" run identical code.

## The journey & what I learned

The most valuable lesson mirrored the whitepaper's "Agent = Model + Harness": most of the work — and most of the reliability — lives in the harness, not the model. Three concrete examples:

1. **Stacking the pipeline beats a bigger prompt.** Self-query + multi-vector retrieval + a final LLM rank consistently beat handing the model everything and hoping.
2. **Least privilege is a design tool, not just a security checkbox.** Giving each ADK specialist a filtered toolset made the orchestrator's routing cleaner and the system easier to reason about.
3. **Transient failures are part of the contract.** During development Gemini periodically returned 503 "high demand." Adding backoff retries turned an intermittent demo-breaker into a non-event — exactly the kind of harness work that separates a prototype from a product.

I verified the whole loop end-to-end: the ADK orchestrator delegates (`transfer_to_agent`), the specialist calls the MCP tool, the MCP server runs the real pipeline, and a query like *"who works in design?"* returns the designer and the UX researcher from Firestore.

## Impact & what's next

For students and young professionals — people who meet many contacts but won't run a heavyweight CRM — Just Contacts makes remembering people effortless: you talk, it organizes, it reminds. Natural next steps: human-in-the-loop confirmation on write tools (ADK's `require_confirmation`), an evaluation suite with an LM judge over the parse/search flows, and exposing the same MCP server to other assistants so your "second memory" follows you across tools.

The result is more than a prototype: a real, deployed product with a portable, standards-based agent layer that demonstrates every concept from the course.

---

*Built with Antigravity · Google ADK · Model Context Protocol · Genkit + Gemini · Firebase.*
