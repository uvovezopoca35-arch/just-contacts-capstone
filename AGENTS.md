# AGENTS.md — Just Contacts

> Static context for any coding agent (Antigravity, Claude Code, Gemini CLI, Cursor…)
> working in this repo. Keep it short, dense, and high-signal. Add a rule every
> time an agent does something it should not do again. Treat this file as code:
> reviewed and versioned with the project.

## What this project is
**Just Contacts** is a personal-CRM "second memory for your people". You describe a
person in plain language (or voice, or a forwarded card) and the AI builds a clean,
searchable profile; later you find people by *meaning* and get reminders so you don't
lose touch. It ships as a **Telegram Mini App + bot** and is being extended for the
capstone with an **MCP server** and a **Google ADK multi-agent** layer.

## Stack
- **Next.js 15** (App Router, RSC, server actions) + **TypeScript**, Tailwind, Radix UI.
- **Genkit** + **Gemini** (`gemini-2.5-flash-lite` for reasoning, `gemini-embedding-001`
  @ 256-dim int8 multi-vectors for retrieval). Configured in `src/ai/genkit.ts`.
- **Firebase**: Firestore (data), Auth (Telegram custom tokens / Firebase Auth), App Hosting.
- **MCP**: `mcp-server/` — a stdio MCP server over the existing flows.

## Architecture rules (do not break)
- **Logic vs. server actions are separate on purpose.** Pure AI logic lives in
  `src/ai/logic/*` (importable anywhere — bot webhook, MCP server). The `'use server'`
  wrappers in `src/ai/flows/*` only add `requireAuth` + `enforceRateLimit`. When adding
  a capability, put the core in `logic/`, then wrap it; never duplicate prompts.
- **Vector/search math is I/O-free** in `src/lib/vector.ts` (shared client + server).
  Don't add Firestore/network calls there.
- **Search pipeline order is fixed:** self-query (`search-filters`) → vector backfill →
  query embed → logical filters → candidate selection (semantic ∪ keyword) → LLM
  relevance. Reuse `selectSearchCandidates` / `applySearchFilters`; don't reinvent it.
- **Dossiers are stored as JSON** strings `{ recentSummary, facts }` in a contact's
  `summary` field. Read them via the existing parsers, not ad-hoc `JSON.parse`.

## Data model (Firestore)
- `users/{uid}` — profile, `totalContacts`.
- `users/{uid}/contacts/{contactId}` — `name, firstName, role, tags[], summary(JSON),
  phone, email, vecs[](packed int8), embeddingVersion, isFavorite, ...`.
- `users/{uid}/contacts/{contactId}/history/{historyId}` — `{ type, date, summary }`.
- `bot_state/*`, `rate_limits/*` — server-only (Admin SDK); client access denied.

## Security (hard constraints)
- **Never put secrets in code.** All keys come from env (`.env`, Vercel env). `.env` is
  git-ignored; only `.env.example` is committed.
- **Path-based ownership** is the source of truth — see `firestore.rules`. A user can
  only touch `users/{their-uid}/**`. Ownership fields are immutable after create.
- **The MCP server is hard-scoped to one user** via `MCP_USER_ID`; tool handlers must
  never accept a user id from the model. Keep input guardrails (length caps, empty
  rejection) in `mcp-server/server.ts` ahead of any tool logic.
- Rate-limit every AI entry point (`enforceRateLimit` / the webhook's Firestore limiter).

## Conventions
- Comments explain *why*, not *what*. Match the existing terse, purposeful style.
- Keep prompts in their `logic/` module next to their Zod schema. Cap prompt size
  (truncate history/dossier) — token economy matters; see existing `MAX_*` consts.
- Russian is the product's primary UI language; user-facing strings stay localizable
  via `src/lib/i18n.tsx`. Code, comments, and docs are in English.

## Commands
- `npm run dev` — app on `http://localhost:9002`.
- `npm run genkit:dev` — Genkit dev UI for flows.
- `npm run mcp` — start the MCP server (stdio). Needs `.env` with `GEMINI_API_KEY`,
  `FIREBASE_SERVICE_ACCOUNT_KEY`, `MCP_USER_ID`.
- `npm run typecheck` — `tsc --noEmit`. Run before declaring a change done.
