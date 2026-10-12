import { z } from "zod";
import type { ExtractedDeal } from "@/pipeline/schemas";

/**
 * Golden-file scoring (PRD §25). Pure, so the comparison rules are unit-tested
 * without calling Gemini. The runner (scripts/golden.ts) supplies extractions.
 */

export const goldenFileSchema = z.object({
  generatedAt: z.string(),
  cases: z
    .array(
      z.object({
        article: z.object({ url: z.string().url(), headline: z.string().nullable(), publication: z.string() }),
        expected: z.object({
          company: z.string(),
          aliases: z.array(z.string()),
          stage: z.string(),
          amountUsd: z.number().positive(),
          /** USD/INR used for the deal, so rupee amounts convert exactly as the pipeline did. */
          fxRate: z.number().positive().nullable(),
          leads: z.array(z.string()),
          sector: z.string(),
        }),
        basis: z.string(),
      }),
    )
    .length(20),
});
export type GoldenCase = z.infer<typeof goldenFileSchema>["cases"][number];

/** Minimum share of cases that must match, per field. */
export const GOLDEN_THRESHOLDS = { company: 0.95, stage: 0.85, amount: 0.85, leads: 0.75 } as const;
/** Amounts within this relative tolerance match (rounding, FX date differences). */
export const AMOUNT_TOLERANCE = 0.1;

export interface GoldenResult {
  company: string;
  found: boolean;
  stage: boolean;
  amount: boolean;
  leads: boolean;
  got: { stage: string; amountUsd: number | null; leads: string[] } | null;
}

interface Norms {
  normalizeCompanyName: (s: string) => string;
  normalizeInvestorKey: (s: string) => string;
  canonicalInvestorName: (s: string) => string | null;
  resolveStage: (canonical: string | null, raw: string | null) => { stage: string };
}

/** USD for an extracted amount; INR converted at the deal's recorded rate. */
function usdOf(d: ExtractedDeal, fxRate: number | null): number | null {
  const a = d.amount;
  if (!a || a.value === null) return null;
  const unit = { crore: 1e7, lakh: 1e5, million: 1e6, billion: 1e9, absolute: 1 }[a.unit ?? "absolute"] ?? 1;
  const raw = a.value * unit;
  return a.currency === "INR" ? raw / (fxRate ?? 85) : raw;
}

export function scoreGoldenCase(c: GoldenCase, extracted: ExtractedDeal[], n: Norms): GoldenResult {
  const names = new Set([c.expected.company, ...c.expected.aliases].map(n.normalizeCompanyName));
  const hit = extracted.find((d) => names.has(n.normalizeCompanyName(d.company_name)) || d.company_aliases.some((a) => names.has(n.normalizeCompanyName(a))));
  if (!hit) return { company: c.expected.company, found: false, stage: false, amount: false, leads: false, got: null };
  // Same stage resolution as Stage C (canonical enum first, then the raw phrase via the mapping table).
  const stage = n.resolveStage(hit.round_stage, hit.stage_raw).stage;
  const amountUsd = usdOf(hit, c.expected.fxRate);
  const leads = hit.investors_lead.map((l) => n.canonicalInvestorName(l) ?? l);
  const want = new Set(c.expected.leads.map(n.normalizeInvestorKey));
  return {
    company: c.expected.company,
    found: true,
    stage: stage === c.expected.stage,
    amount: amountUsd !== null && Math.abs(amountUsd - c.expected.amountUsd) / c.expected.amountUsd <= AMOUNT_TOLERANCE,
    // Leads match when every agreed lead is extracted; with no agreed lead there is nothing to miss.
    leads: [...want].every((w) => leads.some((l) => n.normalizeInvestorKey(l) === w)),
    got: { stage, amountUsd, leads },
  };
}

export function summariseGolden(results: GoldenResult[]): { n: number; company: number; stage: number; amount: number; leads: number; pass: boolean } {
  const share = (k: "found" | "stage" | "amount" | "leads") => results.filter((r) => r[k]).length / Math.max(1, results.length);
  const s = { n: results.length, company: share("found"), stage: share("stage"), amount: share("amount"), leads: share("leads") };
  return {
    ...s,
    pass: s.company >= GOLDEN_THRESHOLDS.company && s.stage >= GOLDEN_THRESHOLDS.stage && s.amount >= GOLDEN_THRESHOLDS.amount && s.leads >= GOLDEN_THRESHOLDS.leads,
  };
}
