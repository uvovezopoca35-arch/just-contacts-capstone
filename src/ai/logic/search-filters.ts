/**
 * Self-query: turns a natural-language search into a semantic part + hard logical
 * filters that embeddings cannot express (exclusions, birthday month). Not a
 * server action — imported by the authed flow wrapper (client) and the bot webhook.
 *
 * Conservative by design: only emit a filter for an *explicit* constraint in the
 * query; everything else stays in `semanticQuery` for the embedding/LLM steps.
 */
import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const SearchFiltersInputSchema = z.object({
  query: z.string().describe('The raw natural-language search query from the user.'),
});
export type SearchFiltersInput = z.infer<typeof SearchFiltersInputSchema>;

export const SearchFiltersOutputSchema = z.object({
  semanticQuery: z.string().describe('The descriptive part of the query, with logical constraints removed, used for meaning-based search.'),
  excludeTerms: z.array(z.string()).describe('Lowercase word stems a matching contact must NOT contain (e.g. from "кроме коллег" -> ["коллег"], "не из Москвы" -> ["москв"]). Empty if none.'),
  birthdayMonth: z.number().min(1).max(12).optional().describe('Birthday month 1-12, only if the query explicitly asks about birthdays in a month.'),
});
export type SearchFiltersOutput = z.infer<typeof SearchFiltersOutputSchema>;

const searchFiltersPrompt = ai.definePrompt({
  name: 'searchFiltersPrompt',
  input: { schema: SearchFiltersInputSchema },
  output: { schema: SearchFiltersOutputSchema },
  prompt: `Вы — парсер поисковых запросов для CRM. Разберите запрос на смысловую часть и жёсткие логические ограничения.

ПРАВИЛА:
1. "semanticQuery" — описательная суть запроса для поиска по смыслу. Уберите из неё логические условия (отрицания, исключения, фильтр по месяцу). Если описательной части нет — верните исходный запрос.
2. "excludeTerms" — основы слов в нижнем регистре, которых НЕ должно быть у контакта. Примеры: «кроме коллег» → ["коллег"]; «не из Москвы» → ["москв"]; «все, кто не дизайнеры» → ["дизайнер"]. Если исключений нет — пустой массив.
3. "birthdayMonth" — число 1-12, ТОЛЬКО если запрос явно про день рождения в конкретном месяце («у кого ДР в июне» → 6). Иначе не указывайте.
4. Будьте консервативны: при сомнении оставляйте условие в semanticQuery и НЕ добавляйте фильтр.

ЗАПРОС: "{{{query}}}"`,
});

export async function extractSearchFiltersFlow(input: SearchFiltersInput): Promise<SearchFiltersOutput> {
  try {
    const { output } = await searchFiltersPrompt(input);
    if (!output) return { semanticQuery: input.query, excludeTerms: [] };
    return {
      semanticQuery: output.semanticQuery?.trim() || input.query,
      excludeTerms: Array.isArray(output.excludeTerms) ? output.excludeTerms.filter(Boolean) : [],
      birthdayMonth: output.birthdayMonth,
    };
  } catch {
    // Self-query is best-effort: on failure fall back to plain semantic search.
    return { semanticQuery: input.query, excludeTerms: [] };
  }
}
