import { z } from "zod";
import { ALL_STAGES, EVENT_TYPES, SECTORS } from "@/lib/taxonomy";

/**
 * The whitelisted filter object behind /explorer, GET /api/deals and the CSV
 * export (PRD §18.5, §22). Natural-language search produces this same object
 * via Gemini and it is validated here before any query runs — the model never
 * writes SQL (CLAUDE.md §7.10). Only the fields below exist; anything else is
 * dropped by Zod.
 */

export const TIERS = ["act_now", "high", "relevant", "context", "archive"] as const;
export const SORTS = ["date", "amount", "score"] as const;

const sectorEnum = z.enum(SECTORS as [string, ...string[]]);
const stageEnum = z.enum(ALL_STAGES as [string, ...string[]]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().min(1).max(80);

export const dealFiltersSchema = z.object({
  profile: z.string().regex(/^[a-z0-9-]+$/).optional(),
  sector: z.array(sectorEnum).max(20).default([]),
  stage: z.array(stageEnum).max(20).default([]),
  tier: z.array(z.enum(TIERS)).max(5).default([]),
  investor: text.optional(),
  city: text.optional(),
  company: text.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  min_amount: z.coerce.number().nonnegative().optional(),
  max_amount: z.coerce.number().positive().optional(),
  verified: z.boolean().default(false),
  mode: z.enum(["live", "backfill", "manual"]).optional(),
  sort: z.enum(SORTS).default("date"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.coerce.number().int().min(0).default(0), // offset
});
export type DealFilters = z.infer<typeof dealFiltersSchema>;

export const eventFiltersSchema = z.object({
  type: z.array(z.enum(EVENT_TYPES)).default([]),
  sector: z.array(sectorEnum).default([]),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: text.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.coerce.number().int().min(0).default(0),
});
export type EventFilters = z.infer<typeof eventFiltersSchema>;

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function all(p: RawParams, key: string): string[] {
  const raw = p instanceof URLSearchParams ? p.getAll(key) : ([] as string[]).concat(p[key] ?? []);
  // Accept repeated keys and comma-separated values (no taxonomy value contains a comma).
  return raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}
function one(p: RawParams, key: string): string | undefined {
  return all(p, key)[0];
}

/** Parse filters from a URL. Invalid values are dropped, never thrown at a page. */
export function parseDealFilters(p: RawParams): DealFilters {
  const candidate = {
    profile: one(p, "profile"),
    sector: all(p, "sector").filter((s) => SECTORS.includes(s)),
    stage: all(p, "stage").filter((s) => ALL_STAGES.includes(s)),
    tier: all(p, "tier").filter((t) => (TIERS as readonly string[]).includes(t)),
    investor: one(p, "investor"),
    city: one(p, "city"),
    company: one(p, "company"),
    from: one(p, "from"),
    to: one(p, "to"),
    min_amount: one(p, "min_amount"),
    max_amount: one(p, "max_amount"),
    verified: one(p, "verified") === "1" || one(p, "verified") === "true",
    mode: one(p, "mode"),
    sort: one(p, "sort"),
    dir: one(p, "dir"),
    limit: one(p, "limit"),
    cursor: one(p, "cursor"),
  };
  const parsed = dealFiltersSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // Drop only the offending fields and keep the rest.
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  return dealFiltersSchema.parse(Object.fromEntries(Object.entries(candidate).filter(([k]) => !bad.has(k))));
}

export function parseEventFilters(p: RawParams): EventFilters {
  const candidate = {
    type: all(p, "type").filter((t) => (EVENT_TYPES as readonly string[]).includes(t)),
    sector: all(p, "sector").filter((s) => SECTORS.includes(s)),
    from: one(p, "from"),
    to: one(p, "to"),
    q: one(p, "q"),
    limit: one(p, "limit"),
    cursor: one(p, "cursor"),
  };
  const parsed = eventFiltersSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  return eventFiltersSchema.parse(Object.fromEntries(Object.entries(candidate).filter(([k]) => !bad.has(k))));
}

/** Serialise filters back to a query string (defaults omitted). */
export function filtersToParams(f: Partial<DealFilters>): URLSearchParams {
  const u = new URLSearchParams();
  if (f.profile) u.set("profile", f.profile);
  for (const s of f.sector ?? []) u.append("sector", s);
  for (const s of f.stage ?? []) u.append("stage", s);
  for (const t of f.tier ?? []) u.append("tier", t);
  for (const k of ["investor", "city", "company", "from", "to", "mode"] as const) if (f[k]) u.set(k, String(f[k]));
  if (f.min_amount !== undefined) u.set("min_amount", String(f.min_amount));
  if (f.max_amount !== undefined) u.set("max_amount", String(f.max_amount));
  if (f.verified) u.set("verified", "1");
  if (f.sort && f.sort !== "date") u.set("sort", f.sort);
  if (f.dir && f.dir !== "desc") u.set("dir", f.dir);
  if (f.limit && f.limit !== 50) u.set("limit", String(f.limit));
  if (f.cursor) u.set("cursor", String(f.cursor));
  return u;
}

// ─── Natural-language search output (Gemini) ───────────────────────────────

/**
 * What Gemini may return for a natural-language query: the same whitelisted
 * fields, every one nullable. `unsupported` lists parts of the question the
 * filters cannot express, so the UI can say so instead of pretending.
 */
export const nlFilterSchema = z.object({
  sector: z.array(sectorEnum).nullable(),
  stage: z.array(stageEnum).nullable(),
  tier: z.array(z.enum(TIERS)).nullable(),
  investor: z.string().max(80).nullable(),
  city: z.string().max(80).nullable(),
  company: z.string().max(80).nullable(),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  min_amount_usd: z.number().nonnegative().nullable(),
  max_amount_usd: z.number().positive().nullable(),
  verified_only: z.boolean().nullable(),
  sort: z.enum(SORTS).nullable(),
  unsupported: z.array(z.string().max(160)).max(5),
});
export type NlFilter = z.infer<typeof nlFilterSchema>;

export function nlToFilters(nl: NlFilter, base: { profile?: string }): DealFilters {
  return dealFiltersSchema.parse({
    profile: base.profile,
    sector: nl.sector ?? [],
    stage: nl.stage ?? [],
    tier: nl.tier ?? [],
    investor: nl.investor?.trim() || undefined,
    city: nl.city?.trim() || undefined,
    company: nl.company?.trim() || undefined,
    from: nl.from ?? undefined,
    to: nl.to ?? undefined,
    min_amount: nl.min_amount_usd ?? undefined,
    max_amount: nl.max_amount_usd ?? undefined,
    verified: nl.verified_only ?? false,
    sort: nl.sort ?? "date",
  });
}
