'use server';
/**
 * @fileOverview Authenticated server action for parsing contact details from natural
 * language text. The implementation lives in src/ai/logic/contact-parsing.ts; the bot
 * webhook calls that core directly (it authenticates requests via the webhook secret).
 */

import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { aiContactParsingFlow } from '@/ai/logic/contact-parsing';
import type { AiContactParsingInput, AiContactParsingOutput } from '@/ai/logic/contact-parsing';

// NOTE: a 'use server' module may only export async functions, so types are NOT
// re-exported here (it breaks Turbopack dev). Import them from '@/ai/logic/contact-parsing'.

export async function parseContactDetails(
  input: AiContactParsingInput,
  idToken: string
): Promise<AiContactParsingOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return aiContactParsingFlow(input);
}
