'use server';
/**
 * @fileOverview Authenticated server action for self-query filter extraction.
 * Core lives in src/ai/logic/search-filters.ts; the bot webhook calls that core
 * directly (it authenticates via the webhook secret).
 */

import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { extractSearchFiltersFlow } from '@/ai/logic/search-filters';
import type { SearchFiltersInput, SearchFiltersOutput } from '@/ai/logic/search-filters';

// NOTE: a 'use server' module may only export async functions, so types are NOT
// re-exported here (it breaks Turbopack dev). Import them from '@/ai/logic/search-filters'.

export async function extractSearchFilters(
  input: SearchFiltersInput,
  idToken: string
): Promise<SearchFiltersOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return extractSearchFiltersFlow(input);
}
