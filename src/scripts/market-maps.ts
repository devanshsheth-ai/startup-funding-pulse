import "dotenv/config";
import { PIPELINE } from "@/config/pipeline";
import { logger, newRunId } from "@/lib/logger";
import { runMarketMaps } from "@/pipeline/market-map";

/** Recompute sector market maps now (same code as the nightly mapclusters stage). */
async function main(): Promise<void> {
  const runId = newRunId();
  let cursor: string | null = null;
  for (let hop = 0; hop < 50; hop++) {
    const r = await runMarketMaps({ runId, cursor, deadline: Date.now() + PIPELINE.invocationBudgetMs });
    cursor = r.next_cursor;
    if (cursor === null) break;
  }
  logger.info("market maps finished", { run_id: runId });
}
main().catch((err: unknown) => {
  logger.error("market maps failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
