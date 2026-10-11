import "dotenv/config";
import { eq } from "drizzle-orm";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import { sources } from "@/db/schema";
import { logger, newRunId } from "@/lib/logger";
import { crossCheck, discoverRoundups, extractRoundups, ingestRoundups } from "@/pipeline/backfill";
import { runDedupe } from "@/pipeline/dedupe";
import { runEnrich } from "@/pipeline/enrich";
import { toIsoDate } from "@/pipeline/normalize";

/**
 * M4 backfill (PRD §19.3).
 *   npm run backfill -- --discover     list the roundups that would be fetched
 *   npm run backfill                   discover → fetch → extract → cross-check → dedupe → enrich
 * Every step is idempotent: re-running skips stored roundups and processed records.
 */

const WEEKS = 13;

async function main(): Promise<void> {
  const runId = newRunId();
  const log = logger.child({ run_id: runId, stage: "backfill" });
  const discoverOnly = process.argv.includes("--discover");
  const today = toIsoDate(new Date());

  const roundupSources = await getDb()
    .select({ id: sources.id, name: sources.name, url: sources.url, config: sources.config })
    .from(sources)
    .where(eq(sources.type, "roundup"));
  if (roundupSources.length === 0) throw new Error("No roundup sources seeded (npm run seed)");

  // 1–2. Discover and store roundups, per source.
  for (const s of roundupSources) {
    const refs = await discoverRoundups(s, { weeks: WEEKS, today });
    log.info("roundups discovered", { source: s.name, count: refs.length, weeks: refs.map((r) => r.weekEnd) });
    if (discoverOnly) {
      for (const r of refs) console.log(`  ${s.name.padEnd(9)} ${r.weekLabel.padEnd(26)} ${r.url}`);
      continue;
    }
    const { stored, failed } = await ingestRoundups(s.id, refs, runId);
    log.info("roundups stored", { source: s.name, stored, failed });
  }
  if (discoverOnly) return;

  // 3. One Gemini call per roundup.
  const ex = await extractRoundups(runId);
  log.info("roundups extracted", { ...ex });
  if (ex.stopReason) log.warn("extraction paused; re-run to resume", { reason: ex.stopReason });

  // 4. Cross-check the most recent 3 weeks against live collection.
  const cc = await crossCheck(runId, 3);
  log.info("cross-check", { ...cc, liveOnly: cc.liveOnly.length, roundupOnly: cc.roundupOnly.length });

  // 5–6. Same normalise → dedupe → enrich path as live data (records are tagged backfill).
  for (let hop = 0; hop < 200; hop++) {
    const r = await runDedupe({ runId, cursor: null, deadline: Date.now() + PIPELINE.invocationBudgetMs });
    if (r.next_cursor === null) break;
  }
  await runEnrich({ runId, cursor: null, deadline: Date.now() + PIPELINE.invocationBudgetMs });
  log.info("backfill complete");
}

main().catch((err: unknown) => {
  logger.error("backfill failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
