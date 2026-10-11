import { nlFilterSchema, nlToFilters, type DealFilters } from "@/lib/deal-filters";
import { GeminiOutputError, GeminiUnavailableError, geminiConfigured, generateStructured } from "@/lib/gemini";
import { ALL_STAGES, SECTORS } from "@/lib/taxonomy";
import { toIsoDate } from "@/pipeline/normalize";

/**
 * Natural-language search (PRD §18.5, CLAUDE.md §7.10): Gemini turns a
 * question into the whitelisted filter object; Zod validates it (inside
 * generateStructured and again in nlToFilters) before any query runs. The
 * model never produces SQL. Responses are cached by content hash.
 */

export interface NlResult {
  filters: DealFilters | null;
  unsupported: string[];
  error: string | null;
}

export async function translateQuery(question: string, base: { profile?: string }, now = new Date()): Promise<NlResult> {
  const q = question.trim().slice(0, 300);
  if (!q) return { filters: null, unsupported: [], error: null };
  if (!geminiConfigured()) return { filters: null, unsupported: [], error: "Natural-language search needs Gemini, which is not configured." };
  try {
    const { data } = await generateStructured({
      task: "filter_nl",
      prompt: { name: "nl-filter", version: 1 },
      vars: { today: toIsoDate(now), sectors: SECTORS.join(" | "), stages: ALL_STAGES.join(" | "), question: q },
      schema: nlFilterSchema,
      temperature: 0.1,
    });
    return { filters: nlToFilters(data, base), unsupported: data.unsupported, error: null };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return { filters: null, unsupported: [], error: "Gemini is unavailable right now; use the filters below." };
    if (err instanceof GeminiOutputError) return { filters: null, unsupported: [], error: "That question could not be turned into filters; try rephrasing." };
    throw err;
  }
}
