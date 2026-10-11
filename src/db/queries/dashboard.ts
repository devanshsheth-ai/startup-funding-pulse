import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { normalCdf } from "@/db/queries/aggregates";
import { addWeeks, weekOf } from "@/db/queries/detection";

/**
 * Dashboard series (PRD §18.1). All statistics in SQL; JS only reshapes. Every
 * series carries its own n so charts can print sample sizes.
 */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export const STAGE_GROUPS: Record<string, string> = {
  Angel: "Early",
  "Pre-seed": "Early",
  Seed: "Early",
  "Pre-Series A": "Early",
  "Series A": "Series A–B",
  "Series B": "Series A–B",
  "Series C": "Late",
  "Series D+": "Late",
  Growth: "Late",
  "Pre-IPO": "Late",
};
export const STAGE_GROUP_ORDER = ["Early", "Series A–B", "Late", "Other"] as const;

export interface WeekPoint {
  week: string;
  partial: boolean;
  n: number;
  priced: number;
  capital: number;
  median: number | null;
  top3Share: number | null;
  investors: number;
  early: number;
  stageCapital: Record<string, number>;
  stageCount: Record<string, number>;
  temperature: number | null;
}

/** The last `weeks` ISO weeks ending with the current (possibly partial) week. */
export async function getWeeklySeries(weeks: number, now: Date): Promise<WeekPoint[]> {
  const current = weekOf(now);
  // Fetch 8 extra weeks so each shown week has a trailing baseline for temperature.
  const span = Array.from({ length: weeks + 8 }, (_, i) => addWeeks(current, i - (weeks + 7)));
  const first = span[0] ?? current;
  const db = getDb();
  const base = z
    .array(z.object({ week: z.string(), n: num, priced: num, capital: num, median: numN, top3: num, early: num, investors: num }))
    .parse(
      (
        await db.execute(sql`
          WITH d AS (SELECT id, iso_week, amount_usd, round_stage,
                            row_number() OVER (PARTITION BY iso_week ORDER BY amount_usd DESC NULLS LAST) AS rk
                     FROM deals WHERE iso_week >= ${first} AND iso_week <= ${current})
          SELECT iso_week AS week, count(*) AS n, count(amount_usd) AS priced, coalesce(sum(amount_usd), 0) AS capital,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) AS median,
                 coalesce(sum(amount_usd) FILTER (WHERE rk <= 3 AND amount_usd IS NOT NULL), 0) AS top3,
                 count(*) FILTER (WHERE round_stage IN ('Angel', 'Pre-seed', 'Seed', 'Pre-Series A')) AS early,
                 (SELECT count(DISTINCT di.investor_id) FROM deal_investors di JOIN deals x ON x.id = di.deal_id WHERE x.iso_week = d.iso_week) AS investors
          FROM d GROUP BY iso_week`)
      ).rows,
    );
  const stages = z
    .array(z.object({ week: z.string(), stage: z.string(), n: num, capital: num }))
    .parse(
      (
        await db.execute(sql`SELECT iso_week AS week, round_stage AS stage, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital
                             FROM deals WHERE iso_week >= ${first} AND iso_week <= ${current} GROUP BY 1, 2`)
      ).rows,
    );
  const byWeek = new Map(base.map((b) => [b.week, b]));
  const all = span.map((week) => {
    const b = byWeek.get(week);
    const stageCapital: Record<string, number> = {};
    const stageCount: Record<string, number> = {};
    for (const s of stages.filter((x) => x.week === week)) {
      const g = STAGE_GROUPS[s.stage] ?? "Other";
      stageCapital[g] = (stageCapital[g] ?? 0) + s.capital;
      stageCount[g] = (stageCount[g] ?? 0) + s.n;
    }
    return {
      week,
      partial: week === current,
      n: b?.n ?? 0,
      priced: b?.priced ?? 0,
      capital: b?.capital ?? 0,
      median: b?.median ?? null,
      top3Share: b && b.capital > 0 ? b.top3 / b.capital : null,
      investors: b?.investors ?? 0,
      early: b?.early ?? 0,
      stageCapital,
      stageCount,
      temperature: null as number | null,
    };
  });
  // Weekly market temperature with the same formula as the Aggregates object
  // (PRD §12.3), over ISO-week buckets; needs ≥ 4 trailing weeks with data.
  for (let i = 0; i < all.length; i++) {
    const cur = all[i];
    const trail = all.slice(Math.max(0, i - 8), i).filter((w) => w.n > 0);
    if (!cur || trail.length < 4 || cur.n === 0) continue;
    const z1 = (x: number, s: number[]) => {
      const m = s.reduce((a, b) => a + b, 0) / s.length;
      const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, s.length - 1));
      return sd > 0 ? (x - m) / sd : 0;
    };
    const early = (w: WeekPoint) => (w.n ? w.early / w.n : 0);
    const breadth = (w: WeekPoint) => 1 - (w.top3Share ?? 0);
    cur.temperature = Math.round(
      100 *
        (0.35 * normalCdf(z1(cur.n, trail.map((w) => w.n))) +
          0.35 * normalCdf(z1(cur.capital, trail.map((w) => w.capital))) +
          0.15 * normalCdf(z1(early(cur), trail.map(early))) +
          0.15 * normalCdf(z1(breadth(cur), trail.map(breadth)))),
    );
  }
  return all.slice(8);
}

export interface WindowStats {
  n: number;
  capital: number;
  median: number | null;
  investors: number;
  watchlistHits: number;
  adjacency: number;
}

/** Headline KPIs for one window and profile (deals, capital, median, investors, hits, adjacency). */
export async function getWindowStats(profileId: string, start: string, end: string): Promise<WindowStats> {
  const res = await getDb().execute(sql`
    SELECT (SELECT count(*) FROM deals WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS n,
           (SELECT coalesce(sum(amount_usd), 0) FROM deals WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS capital,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FROM deals WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS median,
           (SELECT count(DISTINCT di.investor_id) FROM deal_investors di JOIN deals d ON d.id = di.deal_id
             WHERE d.announced_date BETWEEN ${start}::date AND ${end}::date) AS investors,
           (SELECT count(*) FROM relevance_scores rs JOIN deals d ON d.id = rs.deal_id
             WHERE rs.profile_id = ${profileId} AND d.announced_date BETWEEN ${start}::date AND ${end}::date
               AND rs.breakdown -> 'overrides' @> '[{"key":"watchlist"}]'::jsonb) AS watchlist_hits,
           (SELECT count(*) FROM adjacency_edges ae JOIN deals d ON d.id = ae.deal_id JOIN portfolio p ON p.id = ae.portfolio_id
             WHERE ae.profile_id = ${profileId} AND p.is_active AND d.announced_date BETWEEN ${start}::date AND ${end}::date) AS adjacency`);
  const r = z.object({ n: num, capital: num, median: numN, investors: num, watchlist_hits: num, adjacency: num }).parse(res.rows[0]);
  return { n: r.n, capital: r.capital, median: r.median, investors: r.investors, watchlistHits: r.watchlist_hits, adjacency: r.adjacency };
}

/** Per-week watchlist hits and adjacency edges for a profile (KPI sparklines). */
export async function getProfileWeekly(profileId: string, weeks: string[]): Promise<{ week: string; hits: number; adjacency: number }[]> {
  if (weeks.length === 0) return [];
  const first = weeks[0] as string;
  const last = weeks[weeks.length - 1] as string;
  const res = await getDb().execute(sql`
    SELECT d.iso_week AS week,
           count(*) FILTER (WHERE rs.breakdown -> 'overrides' @> '[{"key":"watchlist"}]'::jsonb) AS hits,
           (SELECT count(*) FROM adjacency_edges ae JOIN deals x ON x.id = ae.deal_id JOIN portfolio p ON p.id = ae.portfolio_id
             WHERE ae.profile_id = ${profileId} AND p.is_active AND x.iso_week = d.iso_week) AS adjacency
    FROM deals d LEFT JOIN relevance_scores rs ON rs.deal_id = d.id AND rs.profile_id = ${profileId}
    WHERE d.iso_week BETWEEN ${first} AND ${last} GROUP BY d.iso_week`);
  const rows = z.array(z.object({ week: z.string(), hits: num, adjacency: num })).parse(res.rows);
  return weeks.map((w) => rows.find((r) => r.week === w) ?? { week: w, hits: 0, adjacency: 0 });
}

/** Priced deal sizes in a window, for the histogram. */
export async function getDealSizes(start: string, end: string): Promise<{ amounts: number[]; median: number | null; undisclosed: number }> {
  const res = await getDb().execute(sql`SELECT amount_usd FROM deals WHERE announced_date BETWEEN ${start}::date AND ${end}::date`);
  const vals = z.array(z.object({ amount_usd: numN })).parse(res.rows);
  const amounts = vals.flatMap((v) => (v.amount_usd === null ? [] : [v.amount_usd])).sort((a, b) => a - b);
  const mid = amounts.length / 2;
  const median = amounts.length === 0 ? null : amounts.length % 2 ? (amounts[Math.floor(mid)] ?? null) : ((amounts[mid - 1] ?? 0) + (amounts[mid] ?? 0)) / 2;
  return { amounts, median, undisclosed: vals.length - amounts.length };
}

export const SIZE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "<$500K", min: 0, max: 5e5 },
  { label: "$0.5–1M", min: 5e5, max: 1e6 },
  { label: "$1–2M", min: 1e6, max: 2e6 },
  { label: "$2–5M", min: 2e6, max: 5e6 },
  { label: "$5–10M", min: 5e6, max: 1e7 },
  { label: "$10–25M", min: 1e7, max: 2.5e7 },
  { label: "$25–50M", min: 2.5e7, max: 5e7 },
  { label: "$50–100M", min: 5e7, max: 1e8 },
  { label: "$100M+", min: 1e8, max: Number.POSITIVE_INFINITY },
];

export function histogram(amounts: number[]): { label: string; n: number }[] {
  return SIZE_BUCKETS.map((b) => ({ label: b.label, n: amounts.filter((a) => a >= b.min && a < b.max).length }));
}

export function bucketOf(amount: number | null): string | null {
  if (amount === null) return null;
  return SIZE_BUCKETS.find((b) => amount >= b.min && amount < b.max)?.label ?? null;
}

export interface AdjacencyAlert {
  dealId: string;
  portfolio: string;
  portfolioId: number;
  relationship: string;
  confidence: number;
  rationale: string;
  announced: string;
}

/** Watchlist-hit deal ids and adjacency edges for deals announced in the window. */
export async function getWindowAlerts(profileId: string, start: string, end: string): Promise<{ watchlistDealIds: string[]; adjacency: AdjacencyAlert[] }> {
  const db = getDb();
  const [hits, adj] = await Promise.all([
    db.execute(sql`SELECT rs.deal_id FROM relevance_scores rs JOIN deals d ON d.id = rs.deal_id
                   WHERE rs.profile_id = ${profileId} AND d.announced_date BETWEEN ${start}::date AND ${end}::date
                     AND rs.breakdown -> 'overrides' @> '[{"key":"watchlist"}]'::jsonb
                   ORDER BY rs.score DESC`),
    db.execute(sql`SELECT ae.deal_id, p.name AS portfolio, p.id AS portfolio_id, ae.relationship, ae.confidence, ae.rationale, d.announced_date::text AS announced
                   FROM adjacency_edges ae JOIN portfolio p ON p.id = ae.portfolio_id JOIN deals d ON d.id = ae.deal_id
                   WHERE ae.profile_id = ${profileId} AND p.is_active AND d.announced_date BETWEEN ${start}::date AND ${end}::date
                   ORDER BY CASE ae.relationship WHEN 'competitor' THEN 0 WHEN 'same_layer' THEN 1 ELSE 2 END, ae.confidence DESC`),
  ]);
  return {
    watchlistDealIds: z.array(z.object({ deal_id: z.string() })).parse(hits.rows).map((r) => r.deal_id),
    adjacency: z
      .array(z.object({ deal_id: z.string(), portfolio: z.string(), portfolio_id: num, relationship: z.string(), confidence: num, rationale: z.string(), announced: z.string() }))
      .parse(adj.rows)
      .map((r) => ({ dealId: r.deal_id, portfolio: r.portfolio, portfolioId: r.portfolio_id, relationship: r.relationship, confidence: r.confidence, rationale: r.rationale, announced: r.announced })),
  };
}
