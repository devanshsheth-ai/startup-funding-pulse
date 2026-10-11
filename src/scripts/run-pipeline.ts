import "dotenv/config";
import { logger, newRunId } from "@/lib/logger";
import { dispatch, type DispatchPosition } from "@/pipeline/dispatch";

/**
 * Local equivalent of the cron dispatcher: runs the stage chain, looping
 * through continuations in-process. Same code path as /api/cron/dispatch.
 */
async function main(): Promise<void> {
  const runId = newRunId();
  let position: DispatchPosition | null = { stageIndex: 0, cursor: null };
  let hops = 0;
  while (position && hops < 50) {
    const result = await dispatch(runId, position);
    for (const s of result.steps) logger.info("step", { run_id: runId, ...s });
    position = result.done ? null : result.next;
    hops++;
  }
  logger.info("pipeline finished", { run_id: runId, hops });
}

main().catch((err: unknown) => {
  logger.error("pipeline failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
