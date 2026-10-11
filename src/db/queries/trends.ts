import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/** /trends queries (PRD §18.2). Pure SQL statistics; every cell carries its n. */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export type TrendMetric = "n" | "capital" | "median";

export interface GridCell {
  sector: string;
  week: string;
  n: number;
  capital: number;
  median: number | null;
}

export async function getSectorWeekGrid(first: string, last: string): Promise<GridCell[]> {
  const res = await getDb().execute(sql`
    SELECT sector_primary AS sector, iso_week AS week, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) AS median
    FROM deals WHERE iso_week BETWEEN ${first} AND ${last} GROUP BY 1, 2`);
  return z.array(z.object({ sector: z.string(), week: z.string(), n: num, capital: num, median: numN })).parse(res.rows);
}

/** Median months between consecutive rounds, by sector (deals that report a prior round date). */
export async function getStageVelocity(): Promise<{ sector: string; n: number; medianMonths: number }[]> {
  const res = await getDb().execute(sql`
    SELECT sector_primary AS sector, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (announced_date - prior_round_date) / 30.44) AS median_months
    FROM deals WHERE prior_round_date IS NOT NULL AND prior_round_date < announced_date
    GROUP BY 1 HAVING count(*) >= 2 ORDER BY 3`);
  return z.array(z.object({ sector: z.string(), n: num, median_months: num })).parse(res.rows).map((r) => ({ sector: r.sector, n: r.n, medianMonths: r.median_months }));
}

export async function getLastDealBySector(): Promise<Map<string, { last: string; week: string | null }>> {
  const res = await getDb().execute(sql`
    SELECT DISTINCT ON (sector_primary) sector_primary AS sector, announced_date::text AS last, iso_week AS week
    FROM deals ORDER BY sector_primary, announced_date DESC`);
  return new Map(z.array(z.object({ sector: z.string(), last: z.string(), week: z.string().nullable() })).parse(res.rows).map((r) => [r.sector, { last: r.last, week: r.week }]));
}

export interface PatternRow {
  id: number;
  week: string;
  key: string;
  subject: string;
  title: string;
  statement: string;
  confidence: string;
  sampleSize: number;
  consecutiveWeeks: number;
  evidence: string[];
}

export async function getPatternHistory(profileId: string, limit = 80): Promise<PatternRow[]> {
  const res = await getDb().execute(sql`
    SELECT id, iso_week AS week, detector_key AS key, subject, title, statement, confidence, sample_size, consecutive_weeks, coalesce(evidence_deal_ids, '{}') AS evidence
    FROM patterns WHERE profile_id = ${profileId} OR profile_id IS NULL
    ORDER BY iso_week DESC, consecutive_weeks DESC, id DESC LIMIT ${limit}`);
  return z
    .array(z.object({ id: num, week: z.string(), key: z.string(), subject: z.string(), title: z.string(), statement: z.string(), confidence: z.string(), sample_size: num, consecutive_weeks: num, evidence: z.array(z.string()) }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, week: r.week, key: r.key, subject: r.subject, title: r.title, statement: r.statement, confidence: r.confidence, sampleSize: r.sample_size, consecutiveWeeks: r.consecutive_weeks, evidence: r.evidence }));
}
