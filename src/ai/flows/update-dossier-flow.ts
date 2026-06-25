'use server';
/**
 * Incrementally maintains a contact's dossier ("who is this person").
 * Compares only the current dossier + the new piece of info (constant cost,
 * independent of total history). Returns the dossier unchanged when the new
 * info is just a one-off event/plan that doesn't change who the person is.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const UpdateDossierInputSchema = z.object({
  currentDossier: z.string().optional(),
  contactName: z.string(),
  role: z.string().optional(),
  newInfo: z.string(),
});
export type UpdateDossierInput = z.infer<typeof UpdateDossierInputSchema>;

const UpdateDossierOutputSchema = z.object({
  dossier: z.string().describe('Итоговое досье (возможно, без изменений).'),
});
export type UpdateDossierOutput = z.infer<typeof UpdateDossierOutputSchema>;

const MAX_NEW_INFO = 800;

export async function updateDossier(
  input: UpdateDossierInput,
  idToken: string
): Promise<UpdateDossierOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  const newInfo = (input.newInfo || '').trim().slice(0, MAX_NEW_INFO);
  if (!newInfo) return { dossier: input.currentDossier || '' };
  return updateDossierFlow({
    currentDossier: (input.currentDossier || '').slice(0, 1000),
    contactName: input.contactName || '',
    role: input.role || '',
    newInfo,
  });
}

const updateDossierPrompt = ai.definePrompt({
  name: 'updateDossierPrompt',
  input: { schema: UpdateDossierInputSchema },
  output: { schema: UpdateDossierOutputSchema },
  config: { temperature: 0.2, maxOutputTokens: 300 },
  prompt: `Вы ведёте краткое ДОСЬЕ о человеке — описание того, КТО он: роль/занятие, интересы, как познакомились, устойчивые личные факты. В досье НЕ должно быть разовых встреч, планов и дат-событий.

ТЕКУЩЕЕ ДОСЬЕ — {{{contactName}}}{{#if role}} ({{{role}}}){{/if}}:
{{#if currentDossier}}{{{currentDossier}}}{{else}}(пусто){{/if}}

НОВАЯ ИНФОРМАЦИЯ:
{{{newInfo}}}

ПРАВИЛА:
- Если новая информация добавляет что-то УСТОЙЧИВОЕ о личности (работа, интересы, отношения, важные факты) — дополни/уточни досье, СОХРАНИВ всё, что уже было. Ничего важного не выбрасывай.
- Если это разовое событие/план/встреча и портрет личности не меняется — верни досье БЕЗ изменений.
- Держи кратко: 2-4 предложения. Отвечай на языке имени/досье.
- Верни только текст досье.`,
});

const updateDossierFlow = ai.defineFlow(
  {
    name: 'updateDossierFlow',
    inputSchema: UpdateDossierInputSchema,
    outputSchema: UpdateDossierOutputSchema,
  },
  async (input) => {
    const { output } = await updateDossierPrompt(input);
    if (!output) throw new Error('AI returned empty output');
    return output;
  }
);
