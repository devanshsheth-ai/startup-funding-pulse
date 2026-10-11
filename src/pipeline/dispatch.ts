import { PIPELINE } from "@/config/pipeline";
import { refreshLatestFx } from "@/lib/fx";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import { runDedupe } from "@/pipeline/dedupe";
import { runEnrich } from "@/pipeline/enrich";
import { runExtract } from "@/pipeline/extract";
import { runFilter } from "@/pipeline/filter";
import { runDetect } from "@/pipeline/detect/run";
import { runScore } from "@/pipeline/score";
import { runCollect, type StageResult } from "@/pipeline/ingest/collect";

/**
 * Stage chain run by the single daily cron (PRD §21). Each stage is chunked:
 * it processes up to its limit, returns a cursor, and the dispatcher keeps
 * calling it until the cursor is null or the invocation budget runs out. The
 * caller schedules a continuation with the returned position.
 *
 * Later milestones append stages (score, aggregate, …) to STAGES.
 */

export interface StageContext {
  runId: string;
  cursor: string | null;
  deadline: number;
}

type StageRunner = (ctx: StageContext) => Promise<StageResult>;

async function fxStage(ctx: StageContext): Promise<StageResult> {
  const stage = await startStage(ctx.runId, "fx");
  try {
    const rate = await refreshLatestFx();
    stage.counters.itemsOut = 1;
    await stage.finish("ok", { rate });
  } catch (err) {
    // FX failure degrades conversion freshness; it must not block collection.
    await stage.finish("error", undefined, err instanceof Error ? err.message : String(err));
  }
  return { processed: 1, next_cursor: null };
}

export const STAGES: ReadonlyArray<{ key: string; run: StageRunner }> = [
  { key: "fx", run: fxStage },
  { key: "collect", run: (ctx) => runCollect(ctx) },
  { key: "filter", run: (ctx) => runFilter(ctx) },
  { key: "extract", run: (ctx) => runExtract(ctx) },
  { key: "dedupe", run: (ctx) => runDedupe(ctx) },
  { key: "enrich", run: (ctx) => runEnrich(ctx) },
  // Detect before score: the investor first-move override reads this week's rotation findings.
  { key: "detect", run: (ctx) => runDetect(ctx) },
  { key: "score", run: (ctx) => runScore(ctx) },
];

export interface DispatchPosition {
  stageIndex: number;
  cursor: string | null;
}

export interface DispatchResult {
  runId: string;
  done: boolean;
  next: DispatchPosition | null;
  steps: { stage: string; processed: number; next_cursor: string | null }[];
}

export async function dispatch(runId: string, from: DispatchPosition, startedAt = Date.now()): Promise<DispatchResult> {
  const log = runLogger(runId, "dispatch");
  const deadline = startedAt + PIPELINE.invocationBudgetMs;
  const steps: DispatchResult["steps"] = [];
  let { stageIndex, cursor } = from;

  while (stageIndex < STAGES.length) {
    const stage = STAGES[stageIndex];
    if (!stage) break;
    if (Date.now() > deadline) {
      log.info("budget reached, continuing in next invocation", { stage: stage.key, cursor });
      return { runId, done: false, next: { stageIndex, cursor }, steps };
    }
    const res = await stage.run({ runId, cursor, deadline });
    steps.push({ stage: stage.key, processed: res.processed, next_cursor: res.next_cursor });
    if (res.next_cursor === null) {
      stageIndex++;
      cursor = null;
    } else {
      cursor = res.next_cursor;
    }
  }
  log.info("dispatch complete", { steps: steps.length });
  return { runId, done: true, next: null, steps };
}
