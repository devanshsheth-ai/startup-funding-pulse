import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { quarantine, runLogs } from "@/db/schema";
import { redact } from "@/lib/logger";

/**
 * One `run_logs` row per stage invocation (CLAUDE.md §6): started, finished,
 * counts in/out, Gemini calls and tokens, errors. Errors are redacted before
 * they are persisted.
 */

export type RunStatus = "ok" | "partial" | "error";

export interface StageCounters {
  itemsIn: number;
  itemsOut: number;
  geminiCalls: number;
  geminiTokens: number;
}

export interface StageRun {
  readonly id: number;
  readonly runId: string;
  readonly stage: string;
  readonly counters: StageCounters;
  finish(status: RunStatus, detail?: Record<string, unknown>, error?: string): Promise<void>;
}

function redactText(s: string): string {
  const r = redact(s);
  return typeof r === "string" ? r.slice(0, 2000) : "[redacted]";
}

export async function startStage(runId: string, stage: string): Promise<StageRun> {
  const db = getDb();
  const [row] = await db
    .insert(runLogs)
    .values({ runId, stage, startedAt: new Date(), status: "running" })
    .returning({ id: runLogs.id });
  if (!row) throw new Error("failed to create run_logs row");

  const counters: StageCounters = { itemsIn: 0, itemsOut: 0, geminiCalls: 0, geminiTokens: 0 };
  return {
    id: row.id,
    runId,
    stage,
    counters,
    async finish(status, detail, error) {
      await db
        .update(runLogs)
        .set({
          finishedAt: new Date(),
          status,
          itemsIn: counters.itemsIn,
          itemsOut: counters.itemsOut,
          geminiCalls: counters.geminiCalls,
          geminiTokens: counters.geminiTokens,
          error: error ? redactText(error) : null,
          detail: detail ? (redact(detail) as Record<string, unknown>) : null,
        })
        .where(eq(runLogs.id, row.id));
    },
  };
}

/** Dead-letter path: failures are kept with their payload, never dropped. */
export async function sendToQuarantine(entry: {
  stage: string;
  runId: string;
  error: string;
  rawArticleId?: number | null;
  payload?: unknown;
}): Promise<void> {
  await getDb()
    .insert(quarantine)
    .values({
      stage: entry.stage,
      runId: entry.runId,
      error: redactText(entry.error),
      rawArticleId: entry.rawArticleId ?? null,
      payload: entry.payload === undefined ? null : (redact(entry.payload) as object),
    });
}
