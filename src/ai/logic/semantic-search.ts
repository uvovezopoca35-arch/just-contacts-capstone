/**
 * Core implementation of semantic contact search. Not a server action —
 * imported by the authed flow wrapper (client path) and the bot webhook (server path).
 *
 * Expects a *pre-filtered* candidate list (top-K by embedding similarity),
 * so token cost stays bounded regardless of how many contacts the user has.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ContactSchema = z.object({
  id: z.string().describe('The unique identifier of the contact.'),
  name: z.string().describe('The full name of the contact.'),
  role: z.string().optional().describe('The professional role or title.'),
  tags: z.array(z.string()).describe('An array of descriptive tags associated with the contact.'),
  summary: z.string().describe('An AI-generated summary or dossier (JSON string) containing recent interaction highlights and facts.'),
});

export const AiSemanticContactSearchInputSchema = z.object({
  query: z.string().describe('The natural language query from the user (e.g., "Who loves mountains and travel?").'),
  contacts: z.array(ContactSchema).describe('A list of candidate contact objects including their ID, name, role, tags, and AI-generated summary/dossier.'),
});
export type AiSemanticContactSearchInput = z.infer<typeof AiSemanticContactSearchInputSchema>;

export const AiSemanticContactSearchOutputSchema = z.object({
  relevantContactIds: z.array(z.string()).describe('An array of IDs of contacts that are highly relevant to the user\'s query.'),
});
export type AiSemanticContactSearchOutput = z.infer<typeof AiSemanticContactSearchOutputSchema>;

const aiSemanticContactSearchPrompt = ai.definePrompt({
  name: 'aiSemanticContactSearchPrompt',
  input: { schema: AiSemanticContactSearchInputSchema },
  output: { schema: AiSemanticContactSearchOutputSchema },
  prompt: `Вы — интеллектуальный ассистент CRM. Ваша задача — проанализировать список контактов и найти тех, кто лучше всего соответствует запросу пользователя.

ВНИМАНИЕ: Вы должны искать информацию НЕ ТОЛЬКО в имени и роли, но и в поле "Сводка", которое содержит результаты последних ВСТРЕЧ, ЗВОНКОВ и ключевые факты о человеке.

ИНСТРУКЦИИ:
1. Оценивайте семантическую близость. Если пользователь ищет "дизайнера, который любит горы", ищите упоминание гор в истории встреч (поле summary).
2. Поле "Сводка" (summary) часто содержит JSON с ключами "recentSummary" (итог последних встреч) и "facts". Анализируйте этот текст внимательно.
3. ИГНОРИРУЙТЕ регистр и ошибки в написании имен.
4. Верните только массив ID наиболее релевантных контактов. Если подходящих нет, верните пустой массив.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: "{{{query}}}"

СПИСОК КОНТАКТОВ:
{{#each contacts}}
---
ID: {{{id}}}
Имя: {{{name}}}
Роль: {{{role}}}
Теги: {{#each tags}}{{{this}}}{{#unless @last}}, {{/unless}}{{/each}}
Сводка (досье и история встреч): {{{summary}}}
---
{{/each}}
`,
});

export const aiSemanticContactSearchFlow = ai.defineFlow(
  {
    name: 'aiSemanticContactSearchFlow',
    inputSchema: AiSemanticContactSearchInputSchema,
    outputSchema: AiSemanticContactSearchOutputSchema,
  },
  async (input) => {
    const { output } = await aiSemanticContactSearchPrompt(input);
    if (!output) {
      return { relevantContactIds: [] };
    }
    return output;
  }
);
