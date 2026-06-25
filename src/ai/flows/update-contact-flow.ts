'use server';
/**
 * @fileOverview This file defines a Genkit flow for updating contact details using natural language commands.
 * It takes the current contact state and a user's update request to produce a merged, updated contact object.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';

const UpdateContactInputSchema = z.object({
  currentContact: z.any().describe('The current data of the contact.'),
  updateCommand: z.string().describe('The user\'s natural language command to change contact info.'),
});
export type UpdateContactInput = z.infer<typeof UpdateContactInputSchema>;

const UpdateContactOutputSchema = z.object({
  name: z.string().optional().describe("Updated full name."),
  firstName: z.string().optional().describe("Updated display name or first name."),
  role: z.string().optional().describe("Updated professional role."),
  phone: z.string().optional().describe("Updated phone numbers, comma separated."),
  email: z.string().optional().describe("Updated email addresses, comma separated."),
  summary: z.string().optional().describe("Updated summary/bio based on new info."),
  tags: z.array(z.string()).optional().describe("Updated list of tags."),
  birthday: z.string().optional().describe("Updated birthday in ISO format (YYYY-MM-DD)."),
});
export type UpdateContactOutput = z.infer<typeof UpdateContactOutputSchema>;

export async function updateContactWithAi(
  input: UpdateContactInput,
  idToken: string
): Promise<UpdateContactOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return updateContactFlow(input);
}

const updateContactPrompt = ai.definePrompt({
  name: 'updateContactPrompt',
  input: { schema: UpdateContactInputSchema },
  output: { schema: UpdateContactOutputSchema },
  prompt: `Вы — интеллектуальный CRM-ассистент. Ваша задача — обновить данные контакта на основе текстовой команды.

ТЕКУЩИЕ ДАННЫЕ:
- Имя: {{{currentContact.name}}}
- Имя для обращения: {{{currentContact.firstName}}}
- Роль: {{{currentContact.role}}}
- Телефон: {{{currentContact.phone}}}
- Email: {{{currentContact.email}}}
- Сводка: {{{currentContact.summary}}}
- День рождения: {{{currentContact.birthday}}}

КОМАНДА: """{{{updateCommand}}}"""

АЛГОРИТМ:
1. Проанализируйте команду. Будьте СТРОГИ: если информация в команде нечеткая, НЕ вносите изменения в основные поля.
2. ПРЕПОДАВАНИЕ — это "role" (должность), а не образование.
3. Если обновляется место работы, добавьте его к текущему через запятую, если команда подразумевает "теперь еще и там".
4. Если упоминается дата рождения (например, "17 августа"), преобразуйте её в формат YYYY-MM-DD.
5. ОБЯЗАТЕЛЬНО обновите "summary", добавив туда новую информацию в текстовом виде.
6. Возвращайте ТОЛЬКО те поля, которые действительно изменились.

Язык: РУССКИЙ.
`,
});

const updateContactFlow = ai.defineFlow(
  {
    name: 'updateContactFlow',
    inputSchema: UpdateContactInputSchema,
    outputSchema: UpdateContactOutputSchema,
  },
  async (input) => {
    const { output } = await updateContactPrompt(input);
    if (!output) throw new Error('AI failed to process the update command');
    return output;
  }
);
