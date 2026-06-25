'use server';
/**
 * @fileOverview This file defines a Genkit flow for generating a structured contact dossier.
 * It produces a summary of the last 2 interactions and a list of key extracted facts from the entire history.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const InteractionSchema = z.object({
  type: z.string(),
  date: z.string(),
  summary: z.string(),
});

const SummarizeContactInputSchema = z.object({
  contactName: z.string(),
  role: z.string().optional(),
  interactions: z.array(InteractionSchema),
});
export type SummarizeContactInput = z.infer<typeof SummarizeContactInputSchema>;

const SummarizeContactOutputSchema = z.object({
  recentSummary: z.string().describe('Краткий итог последних встреч.'),
  facts: z.array(z.object({
    label: z.string().describe('Метка факта: Компания, Должность, Образование, Возраст'),
    value: z.string().describe('Значение факта')
  })).describe('Ключевые факты, извлеченные из всей истории.'),
});
export type SummarizeContactOutput = z.infer<typeof SummarizeContactOutputSchema>;

export async function summarizeContactHistory(
  input: SummarizeContactInput,
  idToken: string
): Promise<SummarizeContactOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  // Ensure the interactions are sorted by date descending (newest first)
  const sortedInteractions = [...input.interactions].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  
  // Limit to last 5 for token efficiency, speed and to stay within rate limits
  const limitedInput = {
    ...input,
    interactions: sortedInteractions.slice(0, 5)
  };
  
  return summarizeContactFlow(limitedInput);
}

const summarizeContactPrompt = ai.definePrompt({
  name: 'summarizeContactPrompt',
  input: { schema: SummarizeContactInputSchema },
  output: { schema: SummarizeContactOutputSchema },
  prompt: `Вы — экспертный AI CRM-ассистент. Ваша задача — создать "AI-досье" для контакта по имени {{{contactName}}}.

ИСТОРИЯ ВЗАИМОДЕЙСТВИЙ (от новых к старым):
{{#if interactions}}
{{#each interactions}}
---
СОБЫТИЕ #{{@index}}
Дата: {{{date}}}
Тип: {{{type}}}
Заметки: {{{summary}}}
{{/each}}
{{else}}
История пуста.
{{/if}}

ИНСТРУКЦИИ:
1. **АНАЛИЗ ИСТОРИИ**: Проанализируйте КАЖДОЕ событие по отдельности. Если факт (например, место работы) упомянут только в самом старом событии, он ОБЯЗАТЕЛЬНО должен попасть в список фактов.
2. **ПОСЛЕДНИЕ СОБЫТИЯ (recentSummary)**: Напишите краткий итог (2-3 предложения) на основе ДВУХ самых свежих взаимодействий. Что обсуждали в последний раз?
3. **КЛЮЧЕВЫЕ ФАКТЫ (facts)**: Выделите факты, изучив ВСЮ историю. Используйте СТРОГО только эти метки: "Компания", "Должность", "Образование", "Возраст".
   - **"Компания"**: Место работы. Если их несколько — перечислите через запятую в ОДНОМ поле "Компания".
   - **"Должность"**: Кем человек работает. ПРЕПОДАВАНИЕ — это ДОЛЖНОСТЬ, а не образование.
   - **"Образование"**: Где учился (ВУЗ, курсы).
   - **"Возраст"**: Только если указано число или дата.
4. **СТРОГОСТЬ**: Если данных по конкретной метке нет или вы не уверены на 100% — НЕ добавляйте её в массив "facts".
5. **ЯЗЫК**: Пишите на РУССКОМ языке.
`,
});

const summarizeContactFlow = ai.defineFlow(
  {
    name: 'summarizeContactFlow',
    inputSchema: SummarizeContactInputSchema,
    outputSchema: SummarizeContactOutputSchema,
  },
  async (input) => {
    try {
      const { output } = await summarizeContactPrompt(input);
      if (!output) {
        throw new Error('AI returned empty output');
      }
      return output;
    } catch (error: any) {
      console.error('Summarization Flow Error:', error);
      // Re-throw to let the UI handle the specific error message
      throw error;
    }
  }
);
