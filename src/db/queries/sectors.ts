import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/** Sector page and deep-dive inputs (PRD §18.6). Statistics in SQL; n on every block. */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export async function listSectors(): Promise<{ sector: string; n: number; capital: number; last: string; recent: number }[]> {
  const res = await getDb().execute(sql`
    SELECT sector_primary AS sector, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital, max(announced_date)::text AS last,
           count(*) FILTER (WHERE announced_date >= current_date - 28) AS recent
    FROM deals GROUP BY 1 ORDER BY 2 DESC`);
  return z.array(z.object({ sector: z.string(), n: num, capital: num, last: z.string(), recent: num })).parse(res.rows);
}

export interface SectorSummary {
  sector: string;
  window: { start: string; end: string };
  totals: { n: number; priced: number; capital: number; median: number | null; allTimeN: number };
  weekly: { week: string; n: number; capital: number; median: number | null }[];
  subSectors: { sub: string; n: number; capital: number }[];
  investors: { id: number; name: string; deals: number; lead: number }[];
  chequeByStage: { stage: string; n: number; median: number | null; p25: number | null; p75: number | null; earlierMedian: number | null; earlierN: number }[];
  exits: { id: string; type: string; headline: string; date: string; url: string | null }[];
}

export async function getSectorSummary(sector: string, start: string, end: string): Promise<SectorSummary> {
  const db = getDb();
  // "Earlier" = the same-length span immediately before the window, for cheque evolution.
  const [tot, weekly, subs, invs, cheque, exits] = await Promise.all([
    db.execute(sql`SELECT count(*) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS n,
                          count(amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS priced,
                          coalesce(sum(amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date), 0) AS capital,
                          percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS median,
                          count(*) AS all_n
                   FROM deals WHERE sector_primary = ${sector}`),
    db.execute(sql`SELECT iso_week AS week, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) AS median
                   FROM deals WHERE sector_primary = ${sector} AND iso_week IS NOT NULL GROUP BY 1 ORDER BY 1`),
    db.execute(sql`SELECT coalesce(nullif(trim(sub_sector), ''), 'Unspecified') AS sub, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital
                   FROM deals WHERE sector_primary = ${sector} AND announced_date BETWEEN ${start}::date AND ${end}::date GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 15`),
    db.execute(sql`SELECT i.id, i.canonical_name AS name, count(DISTINCT d.id) AS deals, count(DISTINCT d.id) FILTER (WHERE di.role = 'lead') AS lead
                   FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
                   WHERE d.sector_primary = ${sector} AND d.announced_date BETWEEN ${start}::date AND ${end}::date
                   GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC, 2 LIMIT 12`),
    db.execute(sql`WITH span AS (SELECT (${end}::date - ${start}::date) AS days)
                   SELECT round_stage AS stage,
                          count(amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS n,
                          percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS median,
                          percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS p25,
                          percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) AS p75,
                          percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE announced_date < ${start}::date AND announced_date >= ${start}::date - (SELECT days FROM span)) AS earlier_median,
                          count(amount_usd) FILTER (WHERE announced_date < ${start}::date AND announced_date >= ${start}::date - (SELECT days FROM span)) AS earlier_n
                   FROM deals WHERE sector_primary = ${sector} GROUP BY 1 HAVING count(amount_usd) FILTER (WHERE announced_date BETWEEN ${start}::date AND ${end}::date) > 0 ORDER BY 2 DESC`),
    db.execute(sql`SELECT e.id, e.event_type AS type, e.headline, e.event_date::text AS date,
                          (SELECT es.url FROM event_sources es WHERE es.event_id = e.id ORDER BY es.is_primary DESC LIMIT 1) AS url
                   FROM events e LEFT JOIN companies co ON co.id = e.company_id
                   WHERE e.event_type IN ('ma', 'shutdown', 'ipo_filing') AND (e.sector_primary = ${sector} OR co.sector_primary = ${sector})
                   ORDER BY e.event_date DESC LIMIT 20`),
  ]);
  const t = z.object({ n: num, priced: num, capital: num, median: numN, all_n: num }).parse(tot.rows[0]);
  return {
    sector,
    window: { start, end },
    totals: { n: t.n, priced: t.priced, capital: t.capital, median: t.median, allTimeN: t.all_n },
    weekly: z.array(z.object({ week: z.string(), n: num, capital: num, median: numN })).parse(weekly.rows),
    subSectors: z.array(z.object({ sub: z.string(), n: num, capital: num })).parse(subs.rows),
    investors: z.array(z.object({ id: num, name: z.string(), deals: num, lead: num })).parse(invs.rows),
    chequeByStage: z
      .array(z.object({ stage: z.string(), n: num, median: numN, p25: numN, p75: numN, earlier_median: numN, earlier_n: num }))
      .parse(cheque.rows)
      .map((r) => ({ stage: r.stage, n: r.n, median: r.median, p25: r.p25, p75: r.p75, earlierMedian: r.earlier_median, earlierN: r.earlier_n })),
    exits: z.array(z.object({ id: z.string(), type: z.string(), headline: z.string(), date: z.string(), url: z.string().nullable() })).parse(exits.rows),
  };
}

export interface MapCluster {
  id: number;
  label: string;
  dealCount: number;
  capital: number;
  topInvestors: string[];
  companies: { id: number; name: string }[];
  tracked: string[];
  computedAt: string;
}

/**
 * The latest pre-computed market map for a sector, with each of the profile's
 * tracked companies in that sector placed in its nearest cluster (one cosine
 * lookup per tracked company — no clustering at request time).
 */
export async function getMarketMap(sector: string, profileId: string | null): Promise<MapCluster[]> {
  const db = getDb();
  const res = await db.execute(sql`
    WITH latest AS (SELECT max(computed_at) AS at FROM market_map_clusters WHERE sector = ${sector})
    SELECT m.id, m.cluster_label AS label, coalesce(m.deal_count, 0) AS deal_count, coalesce(m.total_capital_usd, 0) AS capital,
           coalesce(m.top_investors, '{}') AS top_investors, m.computed_at::text AS computed_at,
           coalesce((SELECT json_agg(json_build_object('id', c.id, 'name', c.canonical_name) ORDER BY c.canonical_name)
                     FROM companies c WHERE c.id = ANY (m.company_ids)), '[]'::json) AS companies
    FROM market_map_clusters m, latest WHERE m.sector = ${sector} AND m.computed_at = latest.at
    ORDER BY m.deal_count DESC NULLS LAST`);
  const clusters = z
    .array(z.object({ id: num, label: z.string(), deal_count: num, capital: num, top_investors: z.array(z.string()), computed_at: z.string(), companies: z.array(z.object({ id: num, name: z.string() })) }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, label: r.label, dealCount: r.deal_count, capital: r.capital, topInvestors: r.top_investors, companies: r.companies, tracked: [] as string[], computedAt: r.computed_at }));
  if (!profileId || clusters.length === 0) return clusters;
  const near = await db.execute(sql`
    WITH latest AS (SELECT max(computed_at) AS at FROM market_map_clusters WHERE sector = ${sector})
    SELECT p.name, (SELECT m.id FROM market_map_clusters m, latest WHERE m.sector = ${sector} AND m.computed_at = latest.at AND m.centroid IS NOT NULL
                    ORDER BY m.centroid <=> p.embedding LIMIT 1) AS cluster_id
    FROM portfolio p WHERE p.profile_id = ${profileId} AND p.is_active AND p.sector = ${sector} AND p.embedding IS NOT NULL`);
  for (const r of z.array(z.object({ name: z.string(), cluster_id: numN })).parse(near.rows)) {
    clusters.find((c) => c.id === r.cluster_id)?.tracked.push(r.name);
  }
  return clusters;
}
