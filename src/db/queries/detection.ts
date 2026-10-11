import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/**
 * Stage G inputs for the detectors: every statistic here is computed in SQL
 * (counts, sums, medians, log-scale moments, co-investment counts). The
 * detectors only compare these numbers against their gates.
 */

// ─── ISO week helpers ──────────────────────────────────────────────────────

/** Monday (UTC) of an ISO week "YYYY-Www". */
export function isoWeekMonday(week: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`bad ISO week ${week}`);
  const year = Number(m[1]);
  const wk = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayW1 = new Date(jan4.getTime() - (day - 1) * 86_400_000);
  return new Date(mondayW1.getTime() + (wk - 1) * 7 * 86_400_000);
}

export function weekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const wk = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

export function addWeeks(week: string, delta: number): string {
  return weekOf(new Date(isoWeekMonday(week).getTime() + delta * 7 * 86_400_000));
}

/** Calendar weeks strictly between `from` (inclusive) and `to` (exclusive). */
export function weeksBetween(from: string, to: string): number {
  return Math.round((isoWeekMonday(to).getTime() - isoWeekMonday(from).getTime()) / (7 * 86_400_000));
}

/** The latest ISO week whose Sunday is on or before `today` (a completed week). */
export function latestCompletedWeek(today: Date): string {
  const sunday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = sunday.getUTCDay(); // 0 = Sunday
  if (day !== 0) sunday.setUTCDate(sunday.getUTCDate() - day);
  return weekOf(sunday);
}

// ─── Loader ────────────────────────────────────────────────────────────────

const num = z.coerce.number();
const numN = z.coerce.number().nullable();
const rows = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T>[] => z.array(schema).parse(data);

export async function loadDetectionInput(targetWeek: string, baselineWeeks: number) {
  const db = getDb();
  const baseFrom = addWeeks(targetWeek, -baselineWeeks);
  const q = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows as unknown[];

  const [earliest] = rows(z.object({ week: z.string().nullable() }), await q(sql`SELECT min(iso_week) AS week FROM deals`));

  const sectorWeekly = rows(
    z.object({ week: z.string(), sector: z.string(), n: num, capital: num, deal_ids: z.array(z.string()) }),
    await q(sql`SELECT iso_week AS week, sector_primary AS sector, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital,
                       array_agg(id ORDER BY amount_usd DESC NULLS LAST) AS deal_ids
                FROM deals WHERE iso_week >= ${baseFrom} AND iso_week <= ${targetWeek} GROUP BY 1, 2`),
  );
  const stageWeekly = rows(
    z.object({ week: z.string(), stage: z.string(), n: num, priced: num, capital: num, deal_ids: z.array(z.string()) }),
    await q(sql`SELECT iso_week AS week, round_stage AS stage, count(*) AS n, count(amount_usd) AS priced,
                       coalesce(sum(amount_usd), 0) AS capital, array_agg(id ORDER BY amount_usd DESC NULLS LAST) AS deal_ids
                FROM deals WHERE iso_week >= ${baseFrom} AND iso_week <= ${targetWeek} GROUP BY 1, 2`),
  );
  const cityWeekly = rows(
    z.object({ week: z.string(), city: z.string(), n: num, deal_ids: z.array(z.string()) }),
    await q(sql`SELECT iso_week AS week, hq_city AS city, count(*) AS n, array_agg(id) AS deal_ids
                FROM deals WHERE hq_city IS NOT NULL AND iso_week >= ${baseFrom} AND iso_week <= ${targetWeek} GROUP BY 1, 2`),
  );
  const concentration = rows(
    z.object({ week: z.string(), priced: num, capital: num, top3: num, top3_ids: z.array(z.string()) }),
    await q(sql`WITH ranked AS (
                  SELECT iso_week, id, amount_usd, row_number() OVER (PARTITION BY iso_week ORDER BY amount_usd DESC) AS rk
                  FROM deals WHERE amount_usd IS NOT NULL AND iso_week >= ${baseFrom} AND iso_week <= ${targetWeek})
                SELECT iso_week AS week, count(*) AS priced, sum(amount_usd) AS capital,
                       sum(amount_usd) FILTER (WHERE rk <= 3) AS top3,
                       array_agg(id ORDER BY rk) FILTER (WHERE rk <= 3) AS top3_ids
                FROM ranked GROUP BY 1`),
  );
  const stageMedians = rows(
    z.object({ stage: z.string(), t_n: num, t_median: numN, b_n: num, b_median: numN, t_ids: z.array(z.string()).nullable() }),
    await q(sql`SELECT round_stage AS stage,
                       count(*) FILTER (WHERE iso_week = ${targetWeek}) AS t_n,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE iso_week = ${targetWeek}) AS t_median,
                       count(*) FILTER (WHERE iso_week < ${targetWeek}) AS b_n,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE iso_week < ${targetWeek}) AS b_median,
                       array_agg(id ORDER BY amount_usd DESC) FILTER (WHERE iso_week = ${targetWeek}) AS t_ids
                FROM deals WHERE amount_usd IS NOT NULL AND iso_week >= ${baseFrom} AND iso_week <= ${targetWeek}
                  AND round_stage NOT IN ('Undisclosed', 'Debt', 'Grant', 'Bridge')
                GROUP BY 1`),
  );
  // Investor first moves this week, with every guard input (PRD §14.3).
  const investorFirsts = rows(
    z.object({
      investor_id: num, investor: z.string(), sector: z.string(), deal_id: z.string(),
      deal_count: num, first_seen: z.coerce.date().nullable(), prior_in_sector: num,
    }),
    await q(sql`SELECT i.id AS investor_id, i.canonical_name AS investor, d.sector_primary AS sector, d.id AS deal_id,
                       i.deal_count, i.first_seen_at AS first_seen,
                       (SELECT count(*) FROM deal_investors di2 JOIN deals d2 ON d2.id = di2.deal_id
                         WHERE di2.investor_id = i.id AND d2.sector_primary = d.sector_primary AND d2.iso_week < ${targetWeek}) AS prior_in_sector
                FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
                WHERE d.iso_week = ${targetWeek} AND di.role IN ('lead', 'participating')`),
  );
  const coinvest = rows(
    z.object({ a: z.string(), b: z.string(), together: num, a_deals: num, b_deals: num, total: num, deal_ids: z.array(z.string()), in_target: z.boolean() }),
    await q(sql`WITH links AS (SELECT DISTINCT deal_id, investor_id FROM deal_investors),
                pairs AS (
                  SELECT l1.investor_id AS a, l2.investor_id AS b, array_agg(l1.deal_id) AS deal_ids, count(*) AS together
                  FROM links l1 JOIN links l2 ON l1.deal_id = l2.deal_id AND l1.investor_id < l2.investor_id
                  GROUP BY 1, 2 HAVING count(*) >= 2),
                totals AS (SELECT count(DISTINCT deal_id) AS total FROM links),
                per AS (SELECT investor_id, count(DISTINCT deal_id) AS n FROM links GROUP BY 1)
                SELECT ia.canonical_name AS a, ib.canonical_name AS b, p.together, pa.n AS a_deals, pb.n AS b_deals, t.total, p.deal_ids,
                       EXISTS (SELECT 1 FROM deals d WHERE d.id = ANY(p.deal_ids) AND d.iso_week = ${targetWeek}) AS in_target
                FROM pairs p JOIN totals t ON TRUE JOIN per pa ON pa.investor_id = p.a JOIN per pb ON pb.investor_id = p.b
                JOIN investors ia ON ia.id = p.a JOIN investors ib ON ib.id = p.b`),
  );
  // Round pairs: stated prior round → this round, plus consecutive observed rounds per company.
  const roundPairs = rows(
    z.object({ deal_id: z.string(), later_week: z.string(), gap_months: num }),
    await q(sql`SELECT id AS deal_id, iso_week AS later_week, (announced_date - prior_round_date) / 30.44 AS gap_months
                FROM deals WHERE prior_round_date IS NOT NULL AND prior_round_date < announced_date
                UNION ALL
                SELECT d.id, d.iso_week, (d.announced_date - p.announced_date) / 30.44
                FROM deals d JOIN LATERAL (
                  SELECT announced_date FROM deals p WHERE p.company_id = d.company_id AND p.announced_date < d.announced_date - 30
                  ORDER BY announced_date DESC LIMIT 1) p ON TRUE
                WHERE d.prior_round_date IS NULL`),
  );
  // Outliers: each priced target deal against its bucket, log10 scale, history up to the target week.
  const outliers = rows(
    z.object({
      deal_id: z.string(), stage: z.string(), sector: z.string(), amount: num,
      b_n: num, b_mean: numN, b_sd: numN, s_n: num, s_mean: numN, s_sd: numN,
    }),
    await q(sql`SELECT d.id AS deal_id, d.round_stage AS stage, d.sector_primary AS sector, d.amount_usd AS amount,
                       b.n AS b_n, b.mean AS b_mean, b.sd AS b_sd, s.n AS s_n, s.mean AS s_mean, s.sd AS s_sd
                FROM deals d
                JOIN LATERAL (SELECT count(*) AS n, avg(log(x.amount_usd)) AS mean, stddev_samp(log(x.amount_usd)) AS sd FROM deals x
                              WHERE x.amount_usd > 0 AND x.id <> d.id AND x.round_stage = d.round_stage AND x.sector_primary = d.sector_primary AND x.iso_week <= ${targetWeek}) b ON TRUE
                JOIN LATERAL (SELECT count(*) AS n, avg(log(x.amount_usd)) AS mean, stddev_samp(log(x.amount_usd)) AS sd FROM deals x
                              WHERE x.amount_usd > 0 AND x.id <> d.id AND x.round_stage = d.round_stage AND x.iso_week <= ${targetWeek}) s ON TRUE
                WHERE d.iso_week = ${targetWeek} AND d.amount_usd > 0 AND d.round_stage NOT IN ('Undisclosed')`),
  );
  const founders = rows(
    z.object({ deal_id: z.string(), company: z.string(), founder: z.string(), previous_company: z.string() }),
    await q(sql`SELECT DISTINCT er.deal_id, c.canonical_name AS company, f->>'name' AS founder, f->>'previous_company' AS previous_company
                FROM extracted_records er JOIN deals d ON d.id = er.deal_id JOIN companies c ON c.id = d.company_id,
                     jsonb_array_elements(er.payload->'founders') f
                WHERE er.status = 'merged' AND d.iso_week = ${targetWeek} AND f->>'previous_company' IS NOT NULL`),
  );
  const clusterPairs = rows(
    z.object({ a: z.string(), b: z.string(), sim: num }),
    await q(sql`WITH t AS (SELECT d.id, c.embedding FROM deals d JOIN companies c ON c.id = d.company_id
                           WHERE d.iso_week = ${targetWeek} AND c.embedding IS NOT NULL)
                SELECT x.id AS a, y.id AS b, 1 - (x.embedding <=> y.embedding) AS sim FROM t x JOIN t y ON x.id < y.id`),
  );
  const [corpus] = rows(
    z.object({ p99: numN, pairs: num }),
    await q(sql`WITH c AS (SELECT DISTINCT c.id, c.embedding FROM deals d JOIN companies c ON c.id = d.company_id
                           WHERE c.embedding IS NOT NULL AND d.iso_week <= ${targetWeek})
                SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY 1 - (x.embedding <=> y.embedding)) AS p99, count(*) AS pairs
                FROM c x JOIN c y ON x.id < y.id`),
  );
  const lastDealBySector = rows(
    z.object({ sector: z.string(), week: z.string(), deal_id: z.string() }),
    await q(sql`SELECT DISTINCT ON (sector_primary) sector_primary AS sector, iso_week AS week, id AS deal_id
                FROM deals WHERE iso_week <= ${targetWeek} ORDER BY sector_primary, announced_date DESC`),
  );
  const labels = rows(
    z.object({ id: z.string(), company: z.string(), sector: z.string(), stage: z.string(), amount: numN }),
    await q(sql`SELECT d.id, c.canonical_name AS company, d.sector_primary AS sector, d.round_stage AS stage, d.amount_usd AS amount
                FROM deals d JOIN companies c ON c.id = d.company_id WHERE d.iso_week >= ${baseFrom} AND d.iso_week <= ${targetWeek}`),
  );

  return {
    targetWeek,
    baseFrom,
    earliestWeek: earliest?.week ?? null,
    sectorWeekly,
    stageWeekly,
    cityWeekly,
    concentration,
    stageMedians,
    investorFirsts,
    coinvest,
    roundPairs,
    outliers,
    founders,
    clusterPairs,
    corpusP99: corpus?.p99 ?? null,
    corpusPairs: corpus?.pairs ?? 0,
    lastDealBySector: new Map(lastDealBySector.map((r) => [r.sector, r])),
    labels: new Map(labels.map((l) => [l.id, l])),
  };
}

export type DetectionInput = Awaited<ReturnType<typeof loadDetectionInput>>;
