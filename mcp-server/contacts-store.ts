/**
 * Data + AI access layer for the Just Contacts MCP server.
 *
 * This module is a THIN wrapper: it reuses the exact same Genkit flows and
 * vector pipeline that already ship to real users in the Telegram product
 * (src/ai/logic/* and src/lib/vector). Nothing about the "intelligence" is
 * reimplemented here — the MCP server only exposes that logic over a standard,
 * model-agnostic protocol so any agent (ADK, Claude, Gemini CLI, ...) can use it.
 *
 * ── SECURITY BOUNDARY ───────────────────────────────────────────────────────
 * The server runs with privileged Firebase Admin credentials, so isolation is
 * enforced in code: every operation is hard-scoped to ONE configured user
 * (MCP_USER_ID). Tool handlers never accept a user id from the model, so the
 * agent cannot reach another user's data even if it is prompt-injected into
 * trying. In the live product, per-user isolation is *additionally* enforced by
 * Firebase Auth + firestore.rules (path-based ownership).
 */
import { getAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { aiContactParsingFlow } from '@/ai/logic/contact-parsing';
import { aiSemanticContactSearchFlow } from '@/ai/logic/semantic-search';
import { extractSearchFiltersFlow } from '@/ai/logic/search-filters';
import { embedTextsCore } from '@/ai/logic/embedding';
import {
  buildContactVectors,
  selectSearchCandidates,
  applySearchFilters,
  EMBEDDING_VERSION,
} from '@/lib/vector';

// The single user this MCP server instance is allowed to touch. Required: we
// refuse to start without an explicit scope so an unconfigured server can never
// fall back to "all users".
const USER_ID = process.env.MCP_USER_ID;
if (!USER_ID) {
  throw new Error(
    'MCP_USER_ID is not set. Refusing to start without an explicit single-user data scope.',
  );
}
const uid: string = USER_ID;

function db() {
  return getAdmin().firestore();
}
function contactsCol() {
  return db().collection(`users/${uid}/contacts`);
}

/** Minimal contact shape the search/store pipeline needs from Firestore. */
interface StoredContact {
  id: string;
  name: string;
  firstName?: string;
  role?: string;
  tags?: string[];
  summary?: string;
  phone?: string;
  email?: string;
  birthday?: string;
  vecs?: string[];
  embeddingVersion?: number;
}

/**
 * Contact dossiers are stored as a JSON string: { recentSummary, facts }.
 * This unpacks it into a human-readable shape for read tools.
 */
function parseDossier(summary?: string): {
  recentSummary: string;
  facts: { label: string; value: string }[];
} {
  if (!summary) return { recentSummary: '', facts: [] };
  try {
    const parsed = JSON.parse(summary);
    if (parsed && typeof parsed === 'object') {
      return {
        recentSummary: parsed.recentSummary || '',
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      };
    }
  } catch {
    /* legacy plain-text summary */
  }
  return { recentSummary: summary, facts: [] };
}

// ───────────────────────────── READ ────────────────────────────────────────

/** Lists the user's contacts (newest-ish, capped) with light fields only. */
export async function listContacts(limit = 50) {
  const snap = await contactsCol().limit(Math.min(limit, 200)).get();
  return snap.docs.map((d) => {
    const c = d.data() as StoredContact;
    return {
      id: d.id,
      name: c.name,
      role: c.role || '',
      tags: c.tags || [],
      phone: c.phone || '',
    };
  });
}

/** Returns one contact with its parsed dossier (facts + recent summary). */
export async function getContact(contactId: string) {
  const doc = await contactsCol().doc(contactId).get();
  if (!doc.exists) throw new Error(`Contact ${contactId} not found`);
  const c = doc.data() as StoredContact;
  const { recentSummary, facts } = parseDossier(c.summary);
  return {
    id: doc.id,
    name: c.name,
    firstName: c.firstName || '',
    role: c.role || '',
    tags: c.tags || [],
    phone: c.phone || '',
    email: c.email || '',
    dossier: recentSummary,
    facts,
  };
}

// ───────────────────────────── ADD ─────────────────────────────────────────

/**
 * Parses free-form text into a structured contact and persists it.
 * Mirrors the production Telegram path (parse → de-dupe by phone → write with
 * pre-computed search vectors), so a contact added via an agent is identical to
 * one a human added in the app.
 */
export async function addContact(text: string) {
  // 1. LLM structured extraction (same flow the app uses).
  const parsed = await aiContactParsingFlow({ text });

  // 2. De-dupe by phone, just like the bot, to avoid silent duplicates.
  if (parsed.phone) {
    const dup = await contactsCol().where('phone', '==', parsed.phone).limit(1).get();
    if (!dup.empty) {
      const d = dup.docs[0];
      return {
        status: 'duplicate' as const,
        id: d.id,
        name: d.data().name as string,
        message: `A contact with phone ${parsed.phone} already exists.`,
      };
    }
  }

  // Dossier is stored as JSON so search can read facts + recent summary.
  const structuredSummary = JSON.stringify({
    recentSummary: parsed.summary || '',
    facts: parsed.facts || [],
  });

  // 3. Pre-compute packed multi-vectors (best-effort; search backfills if absent).
  let vecs: string[] | undefined;
  try {
    const built = await buildContactVectors(
      [{ id: 'new', name: parsed.name, role: parsed.role || '', tags: parsed.tags || [], summary: structuredSummary }],
      (texts) => embedTextsCore(texts, 'RETRIEVAL_DOCUMENT'),
    );
    vecs = built.get('new');
  } catch (e) {
    console.warn('[mcp] vector compute at create time failed (non-fatal):', e);
  }

  // 4. Write the contact + an initial history entry, and bump the counter.
  const ref = await contactsCol().add({
    userId: uid,
    name: parsed.name || 'Unnamed',
    firstName: parsed.firstName || parsed.name?.split(' ')[0] || 'Unnamed',
    role: parsed.role || '',
    tags: parsed.tags || [],
    summary: structuredSummary,
    phone: parsed.phone || '',
    email: parsed.email || '',
    ...(vecs ? { vecs, embeddingVersion: EMBEDDING_VERSION } : {}),
    lastInteraction: new Date().toISOString(),
    interactionScore: 50,
    createdAt: new Date().toISOString(),
    isFavorite: false,
    avatarUrl: '',
  });
  await contactsCol()
    .doc(ref.id)
    .collection('history')
    .add({
      contactId: ref.id,
      date: new Date().toISOString(),
      type: 'note',
      summary: 'Added via MCP agent',
      createdAt: FieldValue.serverTimestamp(),
    });
  await db().doc(`users/${uid}`).update({ totalContacts: FieldValue.increment(1) }).catch(() => {});

  return {
    status: 'created' as const,
    id: ref.id,
    name: parsed.name,
    role: parsed.role || '',
    tags: parsed.tags || [],
    phone: parsed.phone || '',
  };
}

// ───────────────────────────── SEARCH ──────────────────────────────────────

/**
 * Meaning-based search over the user's contacts. Reproduces the full production
 * pipeline so agent search === app search:
 *   self-query → vector backfill → query embed → logical filters →
 *   candidate selection (semantic ∪ keyword) → LLM relevance ranking.
 */
export async function searchContacts(query: string) {
  // Pull the corpus (capped — embeddings keep token cost flat regardless).
  const snap = await contactsCol().limit(100).get();
  const contacts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as StoredContact[];
  if (contacts.length === 0) return { results: [] as { id: string; name: string; role: string; tags: string[] }[] };

  // 1. Self-query: split into a semantic part + hard logical filters.
  const extracted = await extractSearchFiltersFlow({ query });
  const semanticQuery = extracted.semanticQuery || query;

  // 2. Backfill packed multi-vectors for contacts missing a current-version set.
  const missing = contacts.filter((c) => !c.vecs?.length || c.embeddingVersion !== EMBEDDING_VERSION);
  if (missing.length > 0) {
    try {
      const built = await buildContactVectors(missing, (texts) => embedTextsCore(texts, 'RETRIEVAL_DOCUMENT'));
      const batch = db().batch();
      missing.forEach((c) => {
        const v = built.get(c.id);
        if (v?.length) {
          c.vecs = v;
          c.embeddingVersion = EMBEDDING_VERSION;
          batch.update(contactsCol().doc(c.id), {
            vecs: v,
            embeddingVersion: EMBEDDING_VERSION,
            embedding: FieldValue.delete(),
          });
        }
      });
      await batch.commit();
    } catch (e) {
      console.warn('[mcp] vector backfill failed, continuing:', e);
    }
  }

  // 3. Embed query, apply logical filters, build a bounded candidate set.
  const [queryVec] = await embedTextsCore([semanticQuery], 'RETRIEVAL_QUERY');
  const withVecs = applySearchFilters(
    contacts.map((c) => ({ ...c, vecs: c.embeddingVersion === EMBEDDING_VERSION ? c.vecs : undefined })),
    { excludeTerms: extracted.excludeTerms, birthdayMonth: extracted.birthdayMonth },
  );
  const candidates = selectSearchCandidates(semanticQuery, queryVec, withVecs);

  // 4. LLM makes the final relevance decision over the small candidate set.
  const ranked = await aiSemanticContactSearchFlow({
    query: semanticQuery,
    contacts: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role || '',
      tags: c.tags || [],
      summary: c.summary || '',
    })),
  });

  const byId = new Map(contacts.map((c) => [c.id, c]));
  const results = ranked.relevantContactIds
    .map((id) => byId.get(id))
    .filter((c): c is StoredContact => !!c)
    .map((c) => ({ id: c.id, name: c.name, role: c.role || '', tags: c.tags || [] }));

  return { results };
}

// ───────────────────────────── ASK ─────────────────────────────────────────

const AskOutputSchema = z.object({
  answer: z.string().describe('Concise answer in the language of the question.'),
});

// Grounded Q&A prompt: answers ONLY from the supplied dossier + recent history,
// and is told to admit when the data is insufficient (no hallucinating).
const askPrompt = ai.definePrompt({
  name: 'mcpAskContactPrompt',
  input: {
    schema: z.object({
      contactName: z.string(),
      role: z.string().optional(),
      dossier: z.string().optional(),
      interactions: z.array(z.object({ date: z.string(), type: z.string(), summary: z.string() })).optional(),
      question: z.string(),
    }),
  },
  output: { schema: AskOutputSchema },
  config: { temperature: 0.2, maxOutputTokens: 400 },
  prompt: `You answer a question about the user's contact using ONLY the data below.

Contact: {{{contactName}}}{{#if role}} ({{{role}}}){{/if}}
{{#if dossier}}DOSSIER: {{{dossier}}}{{/if}}
{{#if interactions.length}}
HISTORY (newest first):
{{#each interactions}}- [{{{date}}}] {{{type}}}: {{{summary}}}
{{/each}}{{/if}}

QUESTION: {{{question}}}

RULES:
- Answer briefly (1-3 sentences), only from the data above.
- If the data is insufficient, say so honestly. Never invent facts.
- Reply in the same language as the question.`,
});

/** Answers a free-form question about one contact, grounded in its dossier + history. */
export async function askAboutContact(contactId: string, question: string) {
  const full = await getContact(contactId);

  // Pull a capped slice of recent interactions for grounding.
  const histSnap = await contactsCol().doc(contactId).collection('history').limit(20).get();
  const interactions = histSnap.docs
    .map((d) => d.data() as { date?: string; type?: string; summary?: string })
    .map((h) => ({ date: (h.date || '').slice(0, 10), type: h.type || 'note', summary: (h.summary || '').slice(0, 280) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 12);

  const dossier = [full.dossier, ...full.facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('. ');

  const { output } = await askPrompt({
    contactName: full.name,
    role: full.role,
    dossier,
    interactions,
    question: question.slice(0, 300),
  });
  return { contactId, answer: output?.answer || '' };
}
