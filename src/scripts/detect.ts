import "dotenv/config";
import { logger, newRunId } from "@/lib/logger";
import { runDetect } from "@/pipeline/detect/run";

/** Run the detectors for the latest completed week (manual trigger; same code as the dispatcher). */
runDetect({ runId: newRunId(), cursor: null, deadline: Date.now() + 50_000 })
  .then(() => logger.info("detect finished"))
  .catch((err: unknown) => {
    logger.error("detect failed", { error: err instanceof Error ? err : String(err) });
    process.exit(1);
  });
