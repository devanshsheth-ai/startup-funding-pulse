import "dotenv/config";
import { PIPELINE } from "@/config/pipeline";
import { logger, newRunId } from "@/lib/logger";
import { runAlerts } from "@/pipeline/alerts/engine";

/** Run the alerts engine now. `--dry` evaluates and logs without emailing. */
async function main(): Promise<void> {
  const runId = newRunId();
  const dry = process.argv.includes("--dry");
  await runAlerts({ runId, cursor: null, deadline: Date.now() + PIPELINE.invocationBudgetMs, send: dry ? false : undefined });
  logger.info("alerts finished", { run_id: runId, dry });
}
main().catch((err: unknown) => {
  logger.error("alerts failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
