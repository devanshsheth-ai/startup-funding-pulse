import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { queryDeals } from "@/db/queries/deals";
import { getMarketMap, getSectorSummary } from "@/db/queries/sectors";
import { dealFiltersSchema } from "@/lib/deal-filters";
import { usd } from "@/lib/format";
import { GeminiOutputError, GeminiUnavailableError, geminiConfigured, generateStructured } from "@/lib/gemini";
import { enforceNarrative, fitHeadline, formatMandate, type NarrativeItem, type Rejection } from "@/pipeline/narrate";
import { toIsoDate } from "@/pipeline/normalize";
import { loadProfileWithName } from "@/pipeline/digest";

/**
 * Sector deep-dive (PRD §18.6): every statistic comes from SQL; Gemini writes
 * 4–6 paragraphs over those aggregates, each with deal evidence that is
 * enforced in code (invented IDs stripped, unsupported paragraphs rejected,
 * ownership language rejected). Cached by content hash, so a repeat click is free.
 */

export const DEEP_DIVE_DAYS = 84;

const deepDiveSchema = z.object({
  headline: z.string().min(1).max(200),
  paragraphs: z
    .array(
      z.object({
        claim: z.string().min(1).max(1500),
        evidence_deal_ids: z.array(z.string()),
        evidence_event_ids: z.array(z.string()),
        confidence: z.enum(["strong", "emerging", "weak_signal"]),
        stat_basis: z.string().max(400),
      }),
    )
    .max(8),
});

export interface DeepDive {
  ok: boolean;
  error: string | null;
  sector: string;
  window: { start: string; end: string };
  headline: string;
  paragraphs: NarrativeItem[];
  evidence: Record<string, { company: string; url: string | null; publication: string | null }>;
  rejected: Rejection[];
  generatedAt: string;
}

export async function generateDeepDive(sector: string, profileId: string, now = new Date()): Promise<DeepDive> {
  const end = toIsoDate(now);
  const start = toIsoDate(new Date(now.getTime() - (DEEP_DIVE_DAYS - 1) * 86_400_000));
  const base: DeepDive = { ok: false, error: null, sector, window: { start, end }, headline: "", paragraphs: [], evidence: {}, rejected: [], generatedAt: now.toISOString() };
  const profile = await loadProfileWithName(profileId);
  if (!profile) return { ...base, error: "unknown profile" };
  const [summary, map, deals] = await Promise.all([
    getSectorSummary(sector, start, end),
    getMarketMap(sector, profileId),
    queryDeals(dealFiltersSchema.parse({ profile: profileId, sector: [sector], from: start, to: end, sort: "amount", limit: 60 })),
  ]);
  if (summary.totals.n === 0) return { ...base, error: `No ${sector} deals in the last ${DEEP_DIVE_DAYS} days.` };
  if (!geminiConfigured()) return { ...base, error: "Gemini is not configured." };

  const tracked = await getDb().execute(sql`
    SELECT p.name, p.sector, p.description,
           (SELECT count(*) FROM adjacency_edges ae JOIN deals d ON d.id = ae.deal_id WHERE ae.portfolio_id = p.id AND d.sector_primary = ${sector}
              AND d.announced_date BETWEEN ${start}::date AND ${end}::date) AS adjacent
    FROM portfolio p WHERE p.profile_id = ${profileId} AND p.is_active`);
  const trackedRows = z.array(z.object({ name: z.string(), sector: z.string(), description: z.string(), adjacent: z.coerce.number() })).parse(tracked.rows).filter((t) => t.sector === sector || t.adjacent > 0);

  const s = summary;
  const aggregates = [
    `Window ${start} to ${end}: ${s.totals.n} deals (${s.totals.priced} priced), capital ${usd(s.totals.capital, { undisclosed: "$0" })}, median ${usd(s.totals.median, { undisclosed: "n/a" })}. All-time deals in this sector in our data: ${s.totals.allTimeN}.`,
    `Sub-sectors (n, capital): ${s.subSectors.map((x) => `${x.sub} ${x.n} / ${usd(x.capital, { undisclosed: "$0" })}`).join("; ")}.`,
    `Most active investors (deals, led): ${s.investors.map((i) => `${i.name} ${i.deals}/${i.lead}`).join("; ") || "none named"}.`,
    `Cheque size by stage (window median [p25–p75], n; prior ${DEEP_DIVE_DAYS}-day median, n): ${s.chequeByStage
      .map((c) => `${c.stage} ${usd(c.median)} [${usd(c.p25)}–${usd(c.p75)}] n=${c.n}; prior ${usd(c.earlierMedian, { undisclosed: "n/a" })} n=${c.earlierN}`)
      .join(" | ")}.`,
    `Weekly deal counts (ISO week: n): ${s.weekly.slice(-12).map((w) => `${w.week.slice(5)}:${w.n}`).join(", ")}.`,
  ].join("\n");
  const mapText = map.length
    ? map.map((c) => `${c.label} (ALL-TIME totals, not this window): ${c.companies.length} companies, ${c.dealCount} deals, ${usd(c.capital, { undisclosed: "$0" })}; top investors ${c.topInvestors.join(", ") || "n/a"}${c.tracked.length ? `; nearest tracked company: ${c.tracked.join(", ")}` : ""}`).join("\n")
    : "No market map computed for this sector yet.";
  const dealText = deals.rows
    .map((d) => `[${d.id}] ${d.company} — ${d.stage}, ${usd(d.amountUsd)}, ${d.subSector ?? "n/a"}, ${d.announced}; lead ${d.leads.map((l) => l.name).join(", ") || "n/a"}; ${d.corroboration} source(s)`)
    .join("\n");

  try {
    const { data } = await generateStructured({
      task: "narrate",
      prompt: { name: "sector-deep-dive", version: 1 },
      vars: {
        sector,
        window: `${start} to ${end}`,
        mandate: formatMandate(profile.config, profile.displayName),
        aggregates,
        map: mapText,
        deals: dealText,
        exits: s.exits.map((e) => `${e.date} ${e.type}: ${e.headline}`).join("\n") || "none in our data",
        tracked: trackedRows.map((t) => `${t.name} (${t.sector}): ${t.description} — ${t.adjacent} adjacent raise(s) in this sector in the window`).join("\n") || "none",
      },
      schema: deepDiveSchema,
      temperature: 0.35,
      maxOutputTokens: 6144,
    });
    const allowed = { deals: new Set(deals.rows.map((d) => d.id)), events: new Set<string>() };
    const names = trackedRows.map((t) => t.name);
    const enforced = enforceNarrative(data.paragraphs, allowed, names);
    const ev: DeepDive["evidence"] = {};
    for (const d of deals.rows) ev[d.id] = { company: d.company, url: d.sources[0]?.url ?? null, publication: d.sources[0]?.publication ?? null };
    const fallback = `${s.totals.n} ${sector} deals, ${usd(s.totals.capital, { undisclosed: "$0" })} in ${DEEP_DIVE_DAYS} days`;
    return {
      ...base,
      ok: enforced.kept.length > 0,
      error: enforced.kept.length ? null : "Every paragraph failed evidence checks; nothing is shown rather than unsupported prose.",
      headline: fitHeadline(data.headline, fallback, names),
      paragraphs: enforced.kept,
      evidence: Object.fromEntries(enforced.kept.flatMap((p) => p.evidenceDealIds).map((id) => [id, ev[id] ?? { company: id, url: null, publication: null }])),
      rejected: enforced.rejected,
    };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return { ...base, error: "Gemini is unavailable right now. The statistics above are unaffected." };
    if (err instanceof GeminiOutputError) return { ...base, error: "The analysis could not be generated; try again." };
    throw err;
  }
}
