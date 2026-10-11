import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import { rawArticles } from "@/db/schema";
import { GeminiOutputError, GeminiUnavailableError, generateStructured } from "@/lib/gemini";
import { runLogger } from "@/lib/logger";
import { sendToQuarantine, startStage } from "@/lib/run-log";
import type { StageResult } from "@/pipeline/ingest/collect";
import { classifyResultSchema } from "@/pipeline/schemas";

/**
 * Stage A — cheap relevance filter (PRD §10).
 *  1. SQL keyword prefilter: articles whose headline + lead contain no
 *     funding/event vocabulary are marked irrelevant without any LLM call.
 *  2. Gemini classifies the survivors in batches of 20 over headline + the
 *     first 300 characters.
 * Verdicts: relevant | irrelevant | error (quarantined, replayable).
 */

export const PREFILTER_PATTERN =
  "(rais(e|es|ed|ing)|fund(ing|s|ed)?|round|series [a-h]|seed|pre-?seed|angel|invest|back(ed|s)|led by|" +
  "acqui|merger|merges|buyout|stake|ipo|drhp|listing|sebi|shut|wind(s|ing)? down|layoff|lay(s)? off|job cuts|" +
  "appoint|joins|hires|elevat|promot|steps down|resign|quits|exits|co-?found|corpus|close|revenue|loss|profit|" +
  "fy2[0-9]|crore|lakh|million|billion|\\$|₹|rs\\.? )";

export function leadOf(headline: string | null, body: string | null): string {
  return `${headline ?? ""}\n${(body ?? "").slice(0, 300)}`.trim();
}

export async function prefilter(): Promise<number> {
  const res = await getDb()
    .update(rawArticles)
    .set({ filterVerdict: "irrelevant", eventTypeGuess: "none", updatedAt: new Date() })
    .where(
      and(
        eq(rawArticles.filterVerdict, "pending"),
        sql`NOT ((coalesce(${rawArticles.headline}, '') || ' ' || left(coalesce(${rawArticles.bodyText}, ''), 300)) ~* ${PREFILTER_PATTERN})`,
      ),
    )
    .returning({ id: rawArticles.id });
  return res.length;
}

export async function runFilter(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const log = runLogger(opts.runId, "filter");
  const stage = await startStage(opts.runId, "filter");
  const db = getDb();
  const batchSize = PIPELINE.filter.batchSize;

  const prefiltered = opts.cursor === null ? await prefilter() : 0;
  let afterId = opts.cursor ? Number(opts.cursor) : 0;
  let relevant = 0;
  let irrelevant = prefiltered;
  let errors = 0;
  let classified = 0;
  let stopReason: string | null = null;

  while (Date.now() < opts.deadline) {
    const batch = await db
      .select({ id: rawArticles.id, headline: rawArticles.headline, bodyText: rawArticles.bodyText })
      .from(rawArticles)
      .where(and(eq(rawArticles.filterVerdict, "pending"), gt(rawArticles.id, afterId)))
      .orderBy(asc(rawArticles.id))
      .limit(batchSize);
    if (batch.length === 0) break;

    const payload = batch.map((a) => ({ article_id: a.id, text: leadOf(a.headline, a.bodyText) }));
    try {
      const { data } = await generateStructured({
        task: "classify",
        prompt: { name: "classify", version: 1 },
        vars: { articles: JSON.stringify(payload, null, 1) },
        schema: classifyResultSchema,
        temperature: 0.1,
        counters: stage.counters,
      });
      const byId = new Map(data.results.map((r) => [r.article_id, r]));
      const rel: { id: number; type: string }[] = [];
      const irr: number[] = [];
      const missing: number[] = [];
      for (const a of batch) {
        const r = byId.get(a.id);
        if (!r) missing.push(a.id);
        else if (r.is_relevant && r.event_type !== "none" && r.confidence >= PIPELINE.filter.minConfidence) {
          rel.push({ id: a.id, type: r.event_type });
        } else irr.push(a.id);
      }
      for (const r of rel) {
        await db
          .update(rawArticles)
          .set({ filterVerdict: "relevant", eventTypeGuess: r.type, runId: opts.runId, updatedAt: new Date() })
          .where(eq(rawArticles.id, r.id));
      }
      if (irr.length) {
        await db
          .update(rawArticles)
          .set({ filterVerdict: "irrelevant", eventTypeGuess: "none", runId: opts.runId, updatedAt: new Date() })
          .where(inArray(rawArticles.id, irr));
      }
      if (missing.length) {
        await db.update(rawArticles).set({ filterVerdict: "error", updatedAt: new Date() }).where(inArray(rawArticles.id, missing));
        await sendToQuarantine({ stage: "filter", runId: opts.runId, error: "Classifier omitted these article_ids", payload: { missing } });
      }
      relevant += rel.length;
      irrelevant += irr.length;
      errors += missing.length;
      classified += batch.length;
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        stopReason = err.message;
        log.warn("gemini unavailable; filter paused", { error: err.message, status: err.status });
        break;
      }
      const ids = batch.map((a) => a.id);
      await db.update(rawArticles).set({ filterVerdict: "error", updatedAt: new Date() }).where(inArray(rawArticles.id, ids));
      await sendToQuarantine({
        stage: "filter",
        runId: opts.runId,
        error: err instanceof Error ? err.message : String(err),
        payload: { article_ids: ids, raw: err instanceof GeminiOutputError ? err.rawText : null },
      });
      errors += ids.length;
    }
    afterId = batch[batch.length - 1]?.id ?? afterId;
  }

  const [remaining] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawArticles)
    .where(and(eq(rawArticles.filterVerdict, "pending"), gt(rawArticles.id, afterId)));
  // Paused on quota: stop this run cleanly; tomorrow's run resumes the backlog.
  const next_cursor = stopReason === null && (remaining?.n ?? 0) > 0 ? String(afterId) : null;

  stage.counters.itemsIn = classified + prefiltered;
  stage.counters.itemsOut = relevant;
  await stage.finish(stopReason ? "partial" : errors > 0 ? "partial" : "ok", {
    prefiltered,
    classified,
    relevant,
    irrelevant,
    errors,
    stopReason,
    next_cursor,
  });
  log.info("filter chunk done", { prefiltered, classified, relevant, irrelevant, errors });
  return { processed: classified + prefiltered, next_cursor };
}
