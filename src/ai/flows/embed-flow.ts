'use server';
/**
 * @fileOverview Authenticated server action for computing text embeddings.
 * Used by the search page: contact embeddings are computed lazily (backfill)
 * and persisted to Firestore by the client; query embeddings are computed per search.
 */

import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { embedTextsCore, type EmbedTaskType } from '@/ai/logic/embedding';

const MAX_TEXTS_PER_CALL = 100;

export async function embedTexts(
  texts: string[],
  idToken: string,
  taskType: EmbedTaskType = 'RETRIEVAL_DOCUMENT'
): Promise<number[][]> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  if (!Array.isArray(texts) || texts.length === 0) return [];
  return embedTextsCore(texts.slice(0, MAX_TEXTS_PER_CALL).map(t => String(t).slice(0, 4000)), taskType);
}
