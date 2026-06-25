/**
 * Pure vector + candidate-selection helpers shared by the client (search page)
 * and the server (bot webhook). No I/O here — just math and string matching.
 */

/**
 * Bump when the way contact embeddings are produced/stored changes (model, task
 * type, dimensionality, packing, or the text built by contactToEmbeddingText).
 * Contacts whose stored `embeddingVersion` differs are treated as un-embedded
 * and recomputed lazily, so a query is never compared against stale vectors.
 *
 * v3: gemini-embedding-001 @ 256 dims, int8-quantized + base64-packed, stored as
 *     a multi-vector array (`vecs`: durable identity + one vector per dossier fact).
 * v2: text-embedding-004 @ 768 dims, float, single vector with task types.
 * v1: text-embedding-004, no task type.
 */
export const EMBEDDING_VERSION = 3;

/** Embedding dimensionality. gemini-embedding-001 is Matryoshka-trained, so a
 *  256-dim truncation keeps most of the quality at a fraction of the size. */
export const EMBED_DIMS = 256;

/** Minimal shape the search pipeline needs from a contact. */
export interface SearchableContact {
  id: string;
  name: string;
  role?: string;
  tags?: string[];
  summary?: string;
  birthday?: string;
  /** base64-packed int8 vectors: [0] durable identity, [1..] per-fact (see packVec) */
  vecs?: string[];
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

/** Cosine similarity. Scale-invariant, so it works directly on int8 vectors. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** L2-normalise then scalar-quantize to int8 ([-127, 127]). */
export function quantizeToInt8(vec: number[]): Int8Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    let v = Math.round((vec[i] / norm) * 127);
    if (v > 127) v = 127; else if (v < -127) v = -127;
    q[i] = v;
  }
  return q;
}

/**
 * Quantize a float embedding to int8 and base64-pack it for compact storage
 * (~15x smaller transfer than a JSON float array). btoa/atob exist in both the
 * browser and modern Node, so this is safe in shared client/server code.
 */
export function packVec(vec: number[]): string {
  const q = quantizeToInt8(vec);
  const bytes = new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Inverse of packVec — returns the int8 vector (usable directly in cosineSimilarity). */
export function unpackVec(b64: string): Int8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int8Array(bytes.buffer);
}

/** Highest cosine similarity between the (float) query and any of a contact's packed vectors. */
export function maxSimilarity(queryVec: number[], packed?: string[]): number {
  if (!queryVec?.length || !packed?.length) return -1;
  let best = -1;
  for (const p of packed) {
    if (!p) continue;
    const v = unpackVec(p);
    if (v.length !== queryVec.length) continue;
    const s = cosineSimilarity(queryVec, v);
    if (s > best) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Text representation
// ---------------------------------------------------------------------------

/** Case- and ё-insensitive normalisation for keyword matching. */
export function normalizeText(s: string): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function parseSummary(summary?: string): { recentSummary: string; facts: string[] } {
  let recentSummary = summary || '';
  let facts: string[] = [];
  try {
    const parsed = JSON.parse(summary || '');
    if (parsed && typeof parsed === 'object') {
      recentSummary = parsed.recentSummary || '';
      if (Array.isArray(parsed.facts)) {
        facts = parsed.facts
          .map((f: { label?: string; value?: string }) => [f.label, f.value].filter(Boolean).join(': '))
          .filter((s: string) => s.trim());
      }
    }
  } catch { /* plain-text summary, keep as recentSummary */ }
  return { recentSummary, facts };
}

type EmbeddableContact = { name?: string; role?: string; tags?: string[]; summary?: string };

/** Single flattened text — used for keyword search (includes everything). */
export function contactToEmbeddingText(contact: EmbeddableContact): string {
  const { recentSummary, facts } = parseSummary(contact.summary);
  return [
    contact.name,
    contact.role,
    contact.tags?.length ? `Теги: ${contact.tags.join(', ')}` : '',
    recentSummary,
    facts.join('. '),
  ].filter(Boolean).join('. ');
}

/**
 * Multi-vector text representation: a durable "who is this" vector (name + role +
 * tags + recent summary) plus one vector per dossier fact. Per-fact vectors stop
 * a specific detail from being averaged away inside one big vector, which
 * improves recall on pointed queries ("кто чинит машины", "у кого есть дача").
 */
export function contactToEmbeddingTexts(contact: EmbeddableContact): string[] {
  const { recentSummary, facts } = parseSummary(contact.summary);
  const base = [
    contact.name,
    contact.role,
    contact.tags?.length ? `Теги: ${contact.tags.join(', ')}` : '',
    recentSummary,
  ].filter(Boolean).join('. ');

  const texts = base ? [base] : [];
  for (const f of facts) texts.push(f);
  return texts.length ? texts : [contact.name || ' '];
}

/** Lowercased, normalised searchable blob (name + role + tags + flattened summary). */
export function contactSearchableText(contact: SearchableContact): string {
  return normalizeText(contactToEmbeddingText(contact));
}

/**
 * Computes packed multi-vectors for a batch of contacts. Flattens every
 * contact's per-fact texts into one list, embeds via the supplied function
 * (the caller owns batching / rate-limit caps), then regroups and packs.
 * Returns id -> packed vecs for contacts that produced at least one vector.
 */
export async function buildContactVectors(
  contacts: { id: string; name?: string; role?: string; tags?: string[]; summary?: string }[],
  embed: (texts: string[]) => Promise<number[][]>
): Promise<Map<string, string[]>> {
  const texts: string[] = [];
  const spans: { id: string; start: number; count: number }[] = [];
  for (const c of contacts) {
    const ts = contactToEmbeddingTexts(c);
    spans.push({ id: c.id, start: texts.length, count: ts.length });
    texts.push(...ts);
  }

  const vectors = texts.length ? await embed(texts) : [];

  const out = new Map<string, string[]>();
  for (const s of spans) {
    const packed = vectors
      .slice(s.start, s.start + s.count)
      .filter(v => v?.length)
      .map(packVec);
    if (packed.length) out.set(s.id, packed);
  }
  return out;
}

const STOPWORDS = new Set([
  'кто', 'что', 'как', 'или', 'для', 'это', 'эта', 'тот', 'нет', 'был', 'была',
  'который', 'которая', 'которые', 'the', 'and', 'who', 'that', 'with',
]);

/** Meaningful query tokens for keyword matching (drops short words and stopwords). */
export function queryTokens(query: string): string[] {
  return normalizeText(query)
    .split(/[^a-zа-я0-9]+/i)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/** Sorts scored items desc and cuts at the largest similarity drop within [minK, maxK]. */
function adaptiveCut(scored: { i: number; score: number }[], minK: number, maxK: number): number[] {
  scored.sort((a, b) => b.score - a.score);
  if (scored.length <= minK) return scored.map(x => x.i);

  const upper = Math.min(maxK, scored.length);
  let cut = upper;
  let biggestGap = -Infinity;
  for (let i = minK; i < upper; i++) {
    const gap = scored[i - 1].score - scored[i].score;
    if (gap > biggestGap) { biggestGap = gap; cut = i; }
  }
  return scored.slice(0, cut).map(x => x.i);
}

export interface CandidateOptions {
  minK?: number;
  maxK?: number;
  maxCandidates?: number;
}

/**
 * Builds the candidate set for the LLM relevance step: the union of
 *   (a) adaptive top-k by max per-fact embedding similarity (semantic recall), and
 *   (b) keyword substring matches the embedding may have missed (lexical recall).
 * Semantic hits come first, keyword-only hits appended, capped to bound cost.
 */
export function selectSearchCandidates<T extends SearchableContact>(
  query: string,
  queryVec: number[] | undefined,
  contacts: T[],
  opts: CandidateOptions = {}
): T[] {
  const minK = opts.minK ?? 12;
  const maxK = opts.maxK ?? 40;
  const maxCandidates = opts.maxCandidates ?? 50;

  // (a) semantic — adaptive top-k over max-sim scores
  const scored = queryVec?.length
    ? contacts
        .map((c, i) => ({ i, score: maxSimilarity(queryVec, c.vecs) }))
        .filter(x => x.score > 0)
    : [];
  const ordered: T[] = adaptiveCut(scored, minK, maxK).map(i => contacts[i]);
  const picked = new Set(ordered.map(c => c.id));

  // (b) lexical — append keyword matches not already selected
  const tokens = queryTokens(query);
  if (tokens.length) {
    for (const c of contacts) {
      if (picked.has(c.id)) continue;
      const text = contactSearchableText(c);
      if (tokens.some(t => text.includes(t))) {
        ordered.push(c);
        picked.add(c.id);
      }
    }
  }

  return ordered.slice(0, maxCandidates);
}

// ---------------------------------------------------------------------------
// Structured (self-query) filters
// ---------------------------------------------------------------------------

/** Hard, logical constraints extracted from a query that embeddings can't express. */
export interface SearchFilters {
  /** Contact excluded if any of these (normalised) terms appears in its text. */
  excludeTerms?: string[];
  /** Birthday month (1-12) the contact must match. */
  birthdayMonth?: number;
}

export function hasActiveFilters(f?: SearchFilters | null): boolean {
  return !!f && ((f.excludeTerms?.length ?? 0) > 0 || !!f.birthdayMonth);
}

/** Applies logical filters before semantic ranking. Embeddings handle meaning; this handles logic. */
export function applySearchFilters<T extends SearchableContact>(contacts: T[], f?: SearchFilters | null): T[] {
  if (!hasActiveFilters(f)) return contacts;
  const exclude = (f!.excludeTerms || []).map(normalizeText).filter(Boolean);
  const month = f!.birthdayMonth;

  return contacts.filter(c => {
    if (exclude.length) {
      const text = contactSearchableText(c);
      if (exclude.some(t => text.includes(t))) return false;
    }
    if (month) {
      if (!c.birthday) return false;
      const d = new Date(c.birthday);
      if (Number.isNaN(d.getTime()) || d.getMonth() + 1 !== month) return false;
    }
    return true;
  });
}
