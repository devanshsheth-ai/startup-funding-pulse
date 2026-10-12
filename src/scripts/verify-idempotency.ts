import "dotenv/config";
import { sql } from "drizzle-orm";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import { logger, newRunId } from "@/lib/logger";
import { runAlerts } from "@/pipeline/alerts/engine";
import { runDedupe } from "@/pipeline/dedupe";
import { runDetect } from "@/pipeline/detect/run";
import { dispatch, type StageContext } from "@/pipeline/dispatch";
import { runEnrich } from "@/pipeline/enrich";
import { runExtract } from "@/pipeline/extract";
import { runFilter } from "@/pipeline/filter";
import { runScore } from "@/pipeline/score";

/**
 * Idempotency check (PRD §25): run every processing stage twice and assert
 * the second pass changes nothing — no new rows anywhere and identical deal
 * values. The first pass absorbs any genuinely pending work. Collection
 * (fetches new articles), delivery (sends email) and market maps (keep a
 * history by design) are excluded; alerts run without sending.
 *   npm run verify:idempotency
 */

const TABLES = ["raw_articles", "extracted_records", "companies", "investors", "deals", "deal_sources", "deal_investors", "events", "event_sources", "relevance_scores", "adjacency_edges", "patterns", "detector_runs", "alerts", "sector_fit", "quarantine"] as const;

const STAGES = [
  { key: "filter", run: (c: StageContext) => runFilter(c) },
  { key: "extract", run: (c: StageContext) => runExtract(c) },
  { key: "dedupe", run: (c: StageContext) => runDedupe(c) },
  { key: "enrich", run: (c: StageContext) => runEnrich(c) },
  { key: "detect", run: (c: StageContext) => runDetect(c) },
  { key: "score", run: (c: StageContext) => runScore(c) },
  { key: "alerts", run: (c: StageContext) => runAlerts({ ...c, send: false }) },
];

async function snapshot(): Promise<Record<string, string | number>> {
  const db = getDb();
  const out: Record<string, string | number> = {};
  for (const t of TABLES) out[t] = Number(((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t}`))).rows[0] as { n: number }).n);
  out.deal_values = String(((await db.execute(sql`SELECT md5(string_agg(id || round_stage || coalesce(amount_usd::text, '') || corroboration_count || is_verified, ',' ORDER BY id)) AS h FROM deals`)).rows[0] as { h: string }).h);
  out.score_values = String(((await db.execute(sql`SELECT md5(string_agg(deal_id || profile_id || score || tier, ',' ORDER BY deal_id, profile_id)) AS h FROM relevance_scores`)).rows[0] as { h: string }).h);
  return out;
}

async function pass(label: string): Promise<void> {
  const runId = newRunId();
  let pos = { stageIndex: 0, cursor: null as string | null };
  for (let hop = 0; hop < 60; hop++) {
    const r = await dispatch(runId, pos, Date.now(), STAGES);
    const failed = r.steps.filter((s) => s.error);
    if (failed.length) throw new Error(`${label}: stage failed: ${failed.map((f) => `${f.stage}: ${f.error}`).join("; ")}`);
    if (r.done || !r.next) return;
    pos = r.next;
  }
  throw new Error(`${label}: did not finish within 60 continuations (budget ${PIPELINE.invocationBudgetMs} ms each)`);
}

async function main(): Promise<void> {
  await pass("pass 1 (absorbs pending work)");
  const a = await snapshot();
  await pass("pass 2");
  const b = await snapshot();
  const diff = Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => ({ table: k, after_pass_1: a[k], after_pass_2: b[k] }));
  logger.info("idempotency check", { identical: diff.length === 0, compared: Object.keys(a).length, counts: a, diff });
  if (diff.length) process.exit(1);
}
main().catch((err: unknown) => {
  logger.error("idempotency check failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
