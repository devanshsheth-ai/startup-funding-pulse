import { z } from "zod";
import { ALL_STAGES, SECTORS } from "@/lib/taxonomy";

/**
 * Request bodies for the settings mutations (PRD §18.8, §22). Shared by the
 * API routes (validation) and the settings UI (client-side hints).
 */

export const WATCH_TYPES = ["company", "investor", "sector", "keyword"] as const;
export const WATCH_STATUSES = ["watching", "raised", "acquired", "dormant"] as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const watchItemSchema = z.object({
  id: z.number().int().positive().optional(),
  watch_type: z.enum(WATCH_TYPES),
  value: trimmed(120),
  aliases: z.array(trimmed(120)).max(20).default([]),
  notes: z.string().trim().max(1000).nullable().default(null),
  tags: z.array(trimmed(40)).max(20).default([]),
  alerts_enabled: z.boolean().default(true),
  status: z.enum(WATCH_STATUSES).default("watching"),
});
export type WatchItem = z.infer<typeof watchItemSchema>;

export const watchUpsertSchema = z.object({
  profile: z.string().regex(/^[a-z0-9-]+$/),
  items: z.array(watchItemSchema).min(1).max(500),
});

/**
 * Adjacency keywords must be specific (CLAUDE.md §7.6): no bare sector names
 * and no one-word generic terms. The seed requires 6–8; the editor accepts
 * 3–10 and the UI nudges towards 6–8 (D-066).
 */
const GENERIC = new Set(["fintech", "healthtech", "saas", "ai", "tech", "technology", "startup", "platform", "app", "software", "ecommerce", "e-commerce", "d2c", "b2b", "b2c", "marketplace", "consumer", "enterprise"]);

export function keywordProblems(keywords: string[]): string[] {
  const sectorNames = new Set(SECTORS.map((s) => s.toLowerCase()));
  const out: string[] = [];
  for (const k of keywords) {
    const l = k.trim().toLowerCase();
    if (sectorNames.has(l)) out.push(`"${k}" is a sector name; use a specific product or customer phrase`);
    else if (GENERIC.has(l)) out.push(`"${k}" is too generic and will match almost every deal`);
    else if (l.length < 3) out.push(`"${k}" is too short`);
  }
  return out;
}

export const portfolioInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    profile: z.string().regex(/^[a-z0-9-]+$/),
    name: trimmed(120),
    description: z.string().trim().min(20, "describe the product and customer in at least 20 characters").max(1000),
    sector: z.string().refine((s) => SECTORS.includes(s), { message: "not a taxonomy sector" }),
    sub_sector: z.string().trim().max(120).nullable().default(null),
    stage_held: z.string().refine((s) => ALL_STAGES.includes(s), { message: "not a canonical stage" }).nullable().default(null),
    city: z.string().trim().max(80).nullable().default(null),
    adjacency_keywords: z.array(trimmed(80)).min(3).max(10),
  })
  .superRefine((v, ctx) => {
    for (const p of keywordProblems(v.adjacency_keywords)) ctx.addIssue({ code: "custom", path: ["adjacency_keywords"], message: p });
  });
export type PortfolioInput = z.infer<typeof portfolioInputSchema>;

/** CSV columns for watchlist import/export — the export is re-importable as-is (PRD §23). */
export const WATCHLIST_CSV_HEADER = ["watch_type", "value", "aliases", "notes", "tags", "alerts_enabled", "status"] as const;

/** One CSV row → a watch item, or an error message. Strips the formula-guard quote added on export. */
export function watchItemFromCsv(cells: string[], header: string[]): { item: WatchItem | null; error: string | null } {
  const get = (k: string) => {
    const v = cells[header.indexOf(k)] ?? "";
    return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
  };
  const list = (v: string) => v.split("|").map((x) => x.trim()).filter(Boolean);
  const parsed = watchItemSchema.safeParse({
    watch_type: get("watch_type").trim().toLowerCase() || "company",
    value: get("value"),
    aliases: list(get("aliases")),
    notes: get("notes").trim() || null,
    tags: list(get("tags")),
    alerts_enabled: !/^(false|0|no|off)$/i.test(get("alerts_enabled").trim()),
    status: get("status").trim().toLowerCase() || "watching",
  });
  return parsed.success ? { item: parsed.data, error: null } : { item: null, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
