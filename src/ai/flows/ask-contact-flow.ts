'use server';
/**
 * @fileOverview Answers a free-form question about a single contact, grounded
 * strictly in that contact's already-distilled dossier (facts + recent summary)
 * plus a capped slice of raw interaction history.
 *
 * Token/speed notes:
 * - The caller passes data already loaded on the contact screen, so no extra
 *   Firestore reads happen.
 * - We send the distilled facts/summary instead of the full raw history, and
 *   cap + truncate the few raw events we do include, to keep the prompt small.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const InteractionSchema = z.object({ type: z.string(), date: z.string(), summary: z.string() });

const AskContactInputSchema = z.object({
  question: z.string(),
  contactName: z.string(),
  role: z.string().optional(),
  dossier: z.string().optional(),
  interactions: z.array(InteractionSchema).optional(),
});
export type AskContactInput = z.infer<typeof AskContactInputSchema>;

const AskContactOutputSchema = z.object({
  answer: z.string().describe('Краткий ответ на вопрос на языке вопроса.'),
});
export type AskContactOutput = z.infer<typeof AskContactOutputSchema>;

// Caps to bound prompt size regardless of how much history a contact has.
const MAX_INTERACTIONS = 12;
const MAX_SUMMARY_CHARS = 280;
const MAX_DOSSIER_CHARS = 700;
const MAX_QUESTION_CHARS = 300;

export async function askAboutContact(
  input: AskContactInput,
  idToken: string
): Promise<AskContactOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);

  const question = (input.question || '').trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) return { answer: '' };

  // Newest first, capped and truncated for token economy.
  const interactions = [...(input.interactions || [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_INTERACTIONS)
    .map(i => ({
      type: i.type || 'note',
      date: (i.date || '').slice(0, 10),
      summary: (i.summary || '').slice(0, MAX_SUMMARY_CHARS),
    }));

  return askContactFlow({
    question,
    contactName: input.contactName || '',
    role: input.role || '',
    dossier: (input.dossier || '').slice(0, MAX_DOSSIER_CHARS),
    interactions,
  });
}

const askContactPrompt = ai.definePrompt({
  name: 'askContactPrompt',
  input: { schema: AskContactInputSchema },
  output: { schema: AskContactOutputSchema },
  config: { temperature: 0.2, maxOutputTokens: 400 },
  prompt: `Вы отвечаете на вопрос пользователя о его контакте, опираясь ТОЛЬКО на данные ниже.

Контакт: {{{contactName}}}{{#if role}} ({{{role}}}){{/if}}
{{#if dossier}}
ДОСЬЕ: {{{dossier}}}{{/if}}
{{#if interactions.length}}
ИСТОРИЯ (от новых к старым):
{{#each interactions}}- [{{{date}}}] {{{type}}}: {{{summary}}}
{{/each}}{{/if}}

ВОПРОС: {{{question}}}

ПРАВИЛА:
- Отвечай кратко (1–3 предложения) и только на основе данных выше.
- Если данных для ответа недостаточно — честно скажи об этом, ничего не выдумывай.
- Отвечай на том же языке, на котором задан вопрос.`,
});

const askContactFlow = ai.defineFlow(
  {
    name: 'askContactFlow',
    inputSchema: AskContactInputSchema,
    outputSchema: AskContactOutputSchema,
  },
  async (input) => {
    const { output } = await askContactPrompt(input);
    if (!output) throw new Error('AI returned empty output');
    return output;
  }
);
