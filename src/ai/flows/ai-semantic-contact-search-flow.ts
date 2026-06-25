'use server';
/**
 * @fileOverview Authenticated server action for semantic contact search.
 * The implementation lives in src/ai/logic/semantic-search.ts; the bot webhook
 * calls that core directly (it authenticates requests via the webhook secret).
 *
 * Callers are expected to pre-filter candidates by embedding similarity
 * (see embedTexts in embed-flow.ts) so only the top-K contacts reach the LLM.
 */

import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { aiSemanticContactSearchFlow } from '@/ai/logic/semantic-search';
import type { AiSemanticContactSearchInput, AiSemanticContactSearchOutput } from '@/ai/logic/semantic-search';

// NOTE: a 'use server' module may only export async functions, so types are NOT
// re-exported here (it breaks Turbopack dev). Import them from '@/ai/logic/semantic-search'.

export async function aiSemanticContactSearch(
  input: AiSemanticContactSearchInput,
  idToken: string
): Promise<AiSemanticContactSearchOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return aiSemanticContactSearchFlow(input);
}
