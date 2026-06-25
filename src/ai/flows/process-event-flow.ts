'use server';
/**
 * @fileOverview This file defines a Genkit flow for processing raw event notes into a structured summary.
 *
 * - processEventNotes - A wrapper function to invoke the AI processing flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const ProcessEventInputSchema = z.object({
  type: z.string().describe('The type of event (e.g., meeting, call, dinner).'),
  rawNotes: z.string().describe('The raw notes taken by the user.'),
  date: z.string().describe('The date of the event.'),
});
export type ProcessEventInput = z.infer<typeof ProcessEventInputSchema>;

const ProcessEventOutputSchema = z.object({
  structuredSummary: z.string().describe('A structured, professional summary of the event.'),
});
export type ProcessEventOutput = z.infer<typeof ProcessEventOutputSchema>;

export async function processEventNotes(
  input: ProcessEventInput,
  idToken: string
): Promise<ProcessEventOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return processEventFlow(input);
}

const processEventPrompt = ai.definePrompt({
  name: 'processEventPrompt',
  input: { schema: ProcessEventInputSchema },
  output: { schema: ProcessEventOutputSchema },
  prompt: `Вы — AI CRM-ассистент. Ваша задача — превратить сырые заметки о событии в профессиональную и краткую сводку.

Тип события: {{{type}}}
Дата: {{{date}}}
Заметки: """{{{rawNotes}}}"""

Пожалуйста, напишите сводку на РУССКОМ ЯЗЫКЕ, которая:
1. Выделяет ключевые договоренности и обсужденные темы.
2. Описывает следующие шаги, если они упомянуты.
3. Соблюдает деловой, но живой стиль.

Форматируйте вывод как JSON-объект с полем "structuredSummary".
`,
});

const processEventFlow = ai.defineFlow(
  {
    name: 'processEventFlow',
    inputSchema: ProcessEventInputSchema,
    outputSchema: ProcessEventOutputSchema,
  },
  async (input) => {
    const { output } = await processEventPrompt(input);
    if (!output) throw new Error('Event processing failed');
    return output;
  }
);
