/**
 * Text embedding helpers (Google gemini-embedding-001, truncated to 256 dims).
 * Used for cheap semantic pre-filtering: instead of sending every contact to the
 * LLM on each search, contacts are matched by cosine similarity first and only
 * the top candidates go to the model.
 *
 * gemini-embedding-001 tops the multilingual MTEB leaderboard (notably better on
 * Russian than text-embedding-004) and is Matryoshka-trained, so the 256-dim
 * truncation keeps most of the quality while shrinking storage/transfer.
 */
import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { EMBED_DIMS } from '@/lib/vector';

const embedder = googleAI.embedder('gemini-embedding-001');

// Keep concurrency modest to stay under the Gemini API rate limits during backfill.
const CHUNK_SIZE = 8;

/**
 * Embedding task type. Documents (contacts) and queries must use *different*
 * task types — RETRIEVAL_DOCUMENT for the corpus, RETRIEVAL_QUERY for searches —
 * which the model optimises asymmetrically and which measurably improves recall.
 */
export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

export async function embedTextsCore(
  texts: string[],
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    const chunk = texts.slice(i, i + CHUNK_SIZE);
    const vectors = await Promise.all(chunk.map(async (text) => {
      const res = await ai.embed({
        embedder,
        content: text || ' ',
        options: { taskType, outputDimensionality: EMBED_DIMS },
      });
      return res[0].embedding;
    }));
    result.push(...vectors);
  }
  return result;
}

export async function embedTextCore(
  text: string,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT'
): Promise<number[]> {
  const [vec] = await embedTextsCore([text], taskType);
  return vec;
}
