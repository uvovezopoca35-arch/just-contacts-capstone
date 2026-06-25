/**
 * Core implementation of contact parsing. Not a server action — imported by
 * the authed flow wrapper (client path) and the bot webhook (server path).
 */
import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const AiContactParsingInputSchema = z.object({
  text: z
    .string()
    .describe('The natural language text describing the contact.'),
});
export type AiContactParsingInput = z.infer<typeof AiContactParsingInputSchema>;

export const AiContactParsingOutputSchema = z.object({
  name: z.string().describe("The contact's full name."),
  firstName: z.string().describe("The name to address the person by (e.g., 'Алексей' instead of 'Смирнов Алексей'). If it's a relationship like 'Мама', return 'Мама'."),
  role: z.string().describe("The contact's professional role, title, or company."),
  tags: z.array(z.string()).describe('A list of descriptive tags for the contact.'),
  summary: z.string().describe("Краткое досье (2-3 предложения): кто этот человек — роль/занятие, интересы, как познакомились, ключевые устойчивые факты. БЕЗ сиюминутных планов и событий."),
  facts: z.array(z.object({
    label: z.string().describe('Fact label (e.g., "Компания", "Должность", "Образование", "Возраст")'),
    value: z.string().describe('Fact value')
  })).describe('Key facts extracted from the input text.'),
  phone: z.string().optional().describe("The contact's phone number(s). Separate multiples with comma."),
  email: z.string().optional().describe("The contact's email address(es). Separate multiples with comma."),
});
export type AiContactParsingOutput = z.infer<typeof AiContactParsingOutputSchema>;

const aiContactParsingPrompt = ai.definePrompt({
  name: 'aiContactParsingPrompt',
  input: {schema: AiContactParsingInputSchema},
  output: {schema: AiContactParsingOutputSchema},
  prompt: `Вы — экспертный ассистент по управлению контактами. Ваша задача — извлечь структурированную информацию из текста.

ВХОДНОЙ ТЕКСТ: """{{{text}}}"""

ИНСТРУКЦИИ (КРИТИЧЕСКИ ВАЖНО):
1. ИМЯ: Выделите имя (firstName — только имя, name — ФИО).
2. РОЛЬ: Текущая основная деятельность или компания.
3. ТЕГИ: Категории (КАПСОМ).
4. ФАКТЫ (facts): Используйте СТРОГО только эти метки: "Компания", "Должность", "Образование", "Возраст".
   - "Компания": Место работы. Если их несколько — перечислите через запятую в ОДНОМ поле "Компания".
   - "Должность": Кем человек работает. ПРЕПОДАВАНИЕ — это ДОЛЖНОСТЬ, а не образование.
   - "Образование": Где учился (ВУЗ, курсы).
   - "Возраст": Только если указано число или дата рождения.
5. СТРОГОСТЬ: Если вы не уверены в факте (информация двусмысленна или это предположение), НЕ добавляйте его в массив "facts". Лучше оставить его только в "summary".
6. ОБЪЕДИНЕНИЕ: В массиве "facts" не должно быть дубликатов меток. Одно поле "Компания" на весь ответ.
7. ДОСЬЕ (summary): 2-3 предложения о том, КТО этот человек (роль, занятие, интересы, как познакомились, устойчивые личные факты). НЕ описывайте разовые встречи и предстоящие планы — только устойчивый портрет личности.

ВНИМАНИЕ: Ответ должен быть строго на РУССКОМ ЯЗЫКЕ.
`,
});

export const aiContactParsingFlow = ai.defineFlow(
  {
    name: 'aiContactParsingFlow',
    inputSchema: AiContactParsingInputSchema,
    outputSchema: AiContactParsingOutputSchema,
  },
  async input => {
    const {output} = await aiContactParsingPrompt(input);
    if (!output) throw new Error('AI failed to parse text');
    return output;
  }
);
