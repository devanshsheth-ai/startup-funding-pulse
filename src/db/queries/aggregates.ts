import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/**
 * Stage G — the Aggregates object (PRD §10 Stage G, §12). Pure SQL, no LLM.
 * Computed for a digest window against a fixed trailing 8-week baseline of
 * 7-day buckets ending at the window start (CLAUDE.md §7.3). Every section
 * carries its sample size `n`; consumers (dashboard, narration) must show it.
 */

export const BASELINE_BUCKETS = 8;
const DAY = 86_400_000;

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export interface Window {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

function windowDays(w: Window): number {
  return Math.max(1, Math.round((Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / DAY) + 1);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), maps a z-score to 0..1. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-((z / Math.SQRT2) ** 2));
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function zScore(x: number, series: number[]): { z: number; mean: number; sd: number } {
  const n = series.length;
  const mean = n ? series.reduce((s, v) => s + v, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { z: sd > 0 ? (x - mean) / sd : 0, mean, sd };
}

export async function getAggregates(win: Window) {
  const db = getDb();
  const q = async <T extends z.ZodTypeAny>(schema: T, query: ReturnType<typeof sql>) => z.array(schema).parse((await db.execute(query)).rows);
  const days = windowDays(win);
  const scale = 7 / days; // normalise window counts to a 7-day rate for baseline comparisons
  const prevStart = new Date(Date.parse(`${win.start}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
  const baseStart = new Date(Date.parse(`${win.start}T00:00:00Z`) - BASELINE_BUCKETS * 7 * DAY).toISOString().slice(0, 10);
  const inWin = sql`announced_date BETWEEN ${win.start}::date AND ${win.end}::date`;
  const bucket = sql`floor((${win.start}::date - announced_date) / 7.0)::int`; // 0 = the 7 days before the window

  const [totals] = await q(
    z.object({ n: num, priced: num, capital: num, median: numN, mean: numN, undisclosed: num, prev_n: num, prev_capital: num }),
    sql`SELECT count(*) FILTER (WHERE ${inWin}) AS n,
               count(amount_usd) FILTER (WHERE ${inWin}) AS priced,
               coalesce(sum(amount_usd) FILTER (WHERE ${inWin}), 0) AS capital,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE ${inWin}) AS median,
               avg(amount_usd) FILTER (WHERE ${inWin}) AS mean,
               count(*) FILTER (WHERE ${inWin} AND amount_usd IS NULL) AS undisclosed,
               count(*) FILTER (WHERE announced_date >= ${prevStart}::date AND announced_date < ${win.start}::date) AS prev_n,
               coalesce(sum(amount_usd) FILTER (WHERE announced_date >= ${prevStart}::date AND announced_date < ${win.start}::date), 0) AS prev_capital
        FROM deals`,
  );
  const weekly = await q(
    z.object({ b: num, n: num, capital: num, early: num, top3: num, priced: num }),
    sql`WITH x AS (SELECT ${bucket} AS b, amount_usd, round_stage,
                          row_number() OVER (PARTITION BY ${bucket} ORDER BY amount_usd DESC NULLS LAST) AS rk
                   FROM deals WHERE announced_date >= ${baseStart}::date AND announced_date < ${win.start}::date)
        SELECT b, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital,
               count(*) FILTER (WHERE round_stage IN ('Pre-seed', 'Seed', 'Pre-Series A')) AS early,
               coalesce(sum(amount_usd) FILTER (WHERE rk <= 3 AND amount_usd IS NOT NULL), 0) AS top3,
               count(amount_usd) AS priced
        FROM x GROUP BY b ORDER BY b`,
  );
  const buckets = Array.from({ length: BASELINE_BUCKETS }, (_, i) => weekly.find((w) => w.b === i) ?? { b: i, n: 0, capital: 0, early: 0, top3: 0, priced: 0 });

  const sectors = await q(
    z.object({ sector: z.string(), n: num, capital: num, prev_n: num, series: z.array(num) }),
    sql`WITH s AS (SELECT DISTINCT sector_primary AS sector FROM deals WHERE announced_date >= ${baseStart}::date AND announced_date <= ${win.end}::date)
        SELECT s.sector,
               (SELECT count(*) FROM deals d WHERE d.sector_primary = s.sector AND ${inWin}) AS n,
               (SELECT coalesce(sum(amount_usd), 0) FROM deals d WHERE d.sector_primary = s.sector AND ${inWin}) AS capital,
               (SELECT count(*) FROM deals d WHERE d.sector_primary = s.sector AND announced_date >= ${prevStart}::date AND announced_date < ${win.start}::date) AS prev_n,
               ARRAY(SELECT (SELECT count(*) FROM deals d WHERE d.sector_primary = s.sector AND announced_date >= ${baseStart}::date
                             AND announced_date < ${win.start}::date AND ${bucket} = g) FROM generate_series(0, ${BASELINE_BUCKETS - 1}) g) AS series
        FROM s`,
  );
  const stages = await q(
    z.object({ stage: z.string(), n: num, priced: num, capital: num, median: numN, base_capital: num }),
    sql`SELECT round_stage AS stage, count(*) FILTER (WHERE ${inWin}) AS n, count(amount_usd) FILTER (WHERE ${inWin}) AS priced,
               coalesce(sum(amount_usd) FILTER (WHERE ${inWin}), 0) AS capital,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) FILTER (WHERE ${inWin}) AS median,
               coalesce(sum(amount_usd) FILTER (WHERE announced_date >= ${baseStart}::date AND announced_date < ${win.start}::date), 0) AS base_capital
        FROM deals WHERE announced_date >= ${baseStart}::date AND announced_date <= ${win.end}::date GROUP BY 1`,
  );
  const cities = await q(
    z.object({ city: z.string(), n: num, capital: num }),
    sql`SELECT hq_city AS city, count(*) AS n, coalesce(sum(amount_usd), 0) AS capital FROM deals WHERE ${inWin} AND hq_city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
  );
  const investors = await q(
    z.object({ investor: z.string(), deals: num, lead_deals: num, capital_led: num, sectors: z.array(z.string()), stages: z.array(z.string()), trailing_8w: num }),
    sql`SELECT i.canonical_name AS investor, count(DISTINCT d.id) AS deals,
               count(DISTINCT d.id) FILTER (WHERE di.role = 'lead') AS lead_deals,
               coalesce(sum(d.amount_usd) FILTER (WHERE di.role = 'lead'), 0) AS capital_led,
               array_agg(DISTINCT d.sector_primary) AS sectors, array_agg(DISTINCT d.round_stage) AS stages,
               (SELECT count(DISTINCT di2.deal_id) FROM deal_investors di2 JOIN deals d2 ON d2.id = di2.deal_id
                 WHERE di2.investor_id = i.id AND d2.announced_date >= ${baseStart}::date AND d2.announced_date < ${win.start}::date) AS trailing_8w
        FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
        WHERE d.announced_date BETWEEN ${win.start}::date AND ${win.end}::date
        GROUP BY i.id, i.canonical_name ORDER BY deals DESC, capital_led DESC LIMIT 25`,
  );
  const pairs = await q(
    z.object({ a: z.string(), b: z.string(), together: num, lift: num }),
    sql`WITH links AS (SELECT DISTINCT deal_id, investor_id FROM deal_investors),
        per AS (SELECT investor_id, count(*) AS n FROM links GROUP BY 1),
        tot AS (SELECT count(DISTINCT deal_id) AS n FROM links),
        p AS (SELECT l1.investor_id a, l2.investor_id b, count(*) AS together
              FROM links l1 JOIN links l2 ON l1.deal_id = l2.deal_id AND l1.investor_id < l2.investor_id GROUP BY 1, 2 HAVING count(*) >= 2)
        SELECT ia.canonical_name AS a, ib.canonical_name AS b, p.together, p.together / ((pa.n * pb.n)::numeric / tot.n) AS lift
        FROM p JOIN per pa ON pa.investor_id = p.a JOIN per pb ON pb.investor_id = p.b CROSS JOIN tot
        JOIN investors ia ON ia.id = p.a JOIN investors ib ON ib.id = p.b ORDER BY together DESC, lift DESC LIMIT 10`,
  );
  const chequeBuckets = await q(
    z.object({ stage: z.string(), sector: z.string(), n: num, p25: num, p50: num, p75: num }),
    sql`SELECT round_stage AS stage, sector_primary AS sector, count(*) AS n,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_usd) AS p25,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_usd) AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_usd) AS p75
        FROM deals WHERE amount_usd IS NOT NULL AND announced_date <= ${win.end}::date GROUP BY 1, 2 HAVING count(*) >= 5 ORDER BY 3 DESC`,
  );
  const roundGaps = await q(
    z.object({ stage: z.string(), sector: z.string(), n: num, median_months: num }),
    sql`SELECT round_stage AS stage, sector_primary AS sector, count(*) AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY (announced_date - prior_round_date) / 30.44) AS median_months
        FROM deals WHERE prior_round_date IS NOT NULL AND prior_round_date < announced_date AND announced_date <= ${win.end}::date
        GROUP BY 1, 2 ORDER BY 3 DESC`,
  );
  const events = await q(
    z.object({ type: z.string(), n: num, amount: num, fund_capital: num }),
    sql`SELECT event_type AS type, count(*) AS n, coalesce(sum(amount_usd), 0) AS amount, coalesce(sum(fund_size_usd), 0) AS fund_capital
        FROM events WHERE event_date BETWEEN ${win.start}::date AND ${win.end}::date GROUP BY 1`,
  );
  const moves = await q(
    z.object({ move_type: z.string(), n: num }),
    sql`SELECT coalesce(move_type, 'unspecified') AS move_type, count(*) AS n FROM events
        WHERE event_type = 'people_move' AND event_date BETWEEN ${win.start}::date AND ${win.end}::date GROUP BY 1`,
  );
  const [coverage] = await q(
    z.object({ sources_polled: num, success_rate: numN, articles: num, relevant: num }),
    sql`SELECT (SELECT count(*) FROM sources WHERE enabled) AS sources_polled,
               (SELECT sum(success_count)::numeric / nullif(sum(success_count + failure_count), 0) FROM sources WHERE enabled) AS success_rate,
               (SELECT count(*) FROM raw_articles WHERE fetched_at::date BETWEEN ${win.start}::date AND ${win.end}::date) AS articles,
               (SELECT count(*) FROM raw_articles WHERE filter_verdict = 'relevant' AND fetched_at::date BETWEEN ${win.start}::date AND ${win.end}::date) AS relevant`,
  );

  const t = totals ?? { n: 0, priced: 0, capital: 0, median: null, mean: null, undisclosed: 0, prev_n: 0, prev_capital: 0 };
  const pricedCapital = t.capital;
  const sectorRows = sectors
    .map((s) => {
      const { z: zz, mean, sd } = zScore(s.n * scale, s.series);
      return { sector: s.sector, n: s.n, capital: s.capital, share_pct: t.n ? (100 * s.n) / t.n : 0, prev_n: s.prev_n, wow_delta: s.n - s.prev_n, baseline_weekly_mean: mean, baseline_sd: sd, z: zz, baseline_n: s.series.reduce((a, b) => a + b, 0) };
    })
    .filter((s) => s.n > 0 || s.baseline_n > 0)
    .sort((a, b) => b.capital - a.capital || b.n - a.n);
  const baseCapTotal = stages.reduce((s, r) => s + r.base_capital, 0);
  const stageRows = stages
    .filter((s) => s.n > 0)
    .map((s) => ({ stage: s.stage, n: s.n, priced_n: s.priced, capital: s.capital, median: s.median, share_pct: pricedCapital ? (100 * s.capital) / pricedCapital : 0, baseline_share_pct: baseCapTotal ? (100 * s.base_capital) / baseCapTotal : 0 }))
    .sort((a, b) => b.capital - a.capital);
  const cityTotal = cities.reduce((s, c) => s + c.n, 0);

  // Market temperature (PRD §12.3): z vs trailing 8 weekly buckets → Φ(z) × 100, weighted.
  const top3Now = await q(z.object({ top3: num }), sql`SELECT coalesce(sum(amount_usd), 0) AS top3 FROM (SELECT amount_usd FROM deals WHERE ${inWin} AND amount_usd IS NOT NULL ORDER BY amount_usd DESC LIMIT 3) x`);
  const concentrationNow = pricedCapital > 0 ? (top3Now[0]?.top3 ?? 0) / pricedCapital : 0;
  const earlyNow = t.n ? (stages.filter((s) => ["Pre-seed", "Seed", "Pre-Series A"].includes(s.stage)).reduce((a, s) => a + s.n, 0) / t.n) : 0;
  const comp = {
    deal_count: { value: t.n * scale, ...zScore(t.n * scale, buckets.map((b) => b.n)) },
    total_capital: { value: t.capital * scale, ...zScore(t.capital * scale, buckets.map((b) => b.capital)) },
    early_stage_share: { value: earlyNow, ...zScore(earlyNow, buckets.map((b) => (b.n ? b.early / b.n : 0))) },
    breadth: { value: 1 - concentrationNow, ...zScore(1 - concentrationNow, buckets.map((b) => (b.capital ? 1 - b.top3 / b.capital : 0))) },
  };
  const temperature =
    100 * (0.35 * normalCdf(comp.deal_count.z) + 0.35 * normalCdf(comp.total_capital.z) + 0.15 * normalCdf(comp.early_stage_share.z) + 0.15 * normalCdf(comp.breadth.z));

  return {
    window: { ...win, days },
    baseline: { start: baseStart, end: win.start, buckets: BASELINE_BUCKETS, n: buckets.reduce((s, b) => s + b.n, 0) },
    totals: {
      n: t.n,
      priced_n: t.priced,
      capital_usd: t.capital,
      median_usd: t.median,
      mean_usd: t.mean,
      undisclosed_n: t.undisclosed,
      previous_window: { n: t.prev_n, capital_usd: t.prev_capital },
      baseline_weekly_mean_n: zScore(0, buckets.map((b) => b.n)).mean,
      baseline_weekly_mean_capital_usd: zScore(0, buckets.map((b) => b.capital)).mean,
    },
    sectors: { n: t.n, rows: sectorRows },
    stages: { n: t.n, priced_n: t.priced, rows: stageRows },
    cities: { n: cityTotal, unreported_n: t.n - cityTotal, rows: cities.map((c) => ({ ...c, share_pct: cityTotal ? (100 * c.n) / cityTotal : 0 })) },
    investors: { n: investors.length, rows: investors.map((i) => ({ ...i, trailing_weekly_rate: i.trailing_8w / BASELINE_BUCKETS })) },
    coinvestment_pairs: { n: pairs.length, rows: pairs },
    concentration: {
      n: t.priced,
      top3_share: concentrationNow,
      baseline_top3_share: zScore(0, buckets.filter((b) => b.capital > 0).map((b) => b.top3 / b.capital)).mean,
    },
    cheque_percentiles: { n: chequeBuckets.reduce((s, c) => s + c.n, 0), rows: chequeBuckets },
    round_gaps: { n: roundGaps.reduce((s, r) => s + r.n, 0), rows: roundGaps },
    events: {
      n: events.reduce((s, e) => s + e.n, 0),
      by_type: events,
      fund_close_capital_usd: events.find((e) => e.type === "fund_close")?.fund_capital ?? 0,
      people_moves: { n: moves.reduce((s, m) => s + m.n, 0), rows: moves },
    },
    temperature: { value: Math.round(temperature), components: comp, n: buckets.length },
    coverage: { ...(coverage ?? { sources_polled: 0, success_rate: null, articles: 0, relevant: 0 }), deals_in_window: t.n },
  };
}

export type Aggregates = Awaited<ReturnType<typeof getAggregates>>;
