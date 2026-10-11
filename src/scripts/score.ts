import "dotenv/config";
import { PIPELINE } from "@/config/pipeline";
import { logger, newRunId } from "@/lib/logger";
import { runScore } from "@/pipeline/score";

/** Rescore all profiles (manual trigger; same code as the dispatcher's score stage). */
async function main(): Promise<void> {
  const runId = newRunId();
  for (let hop = 0; hop < 100; hop++) {
    const r = await runScore({ runId, cursor: null, deadline: Date.now() + PIPELINE.invocationBudgetMs });
    if (r.next_cursor === null) break;
  }
  logger.info("rescore finished", { run_id: runId });
}
main().catch((err: unknown) => {
  logger.error("rescore failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
