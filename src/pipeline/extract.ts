import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import { extractedRecords, rawArticles, sources } from "@/db/schema";
import { GeminiOutputError, GeminiUnavailableError, geminiConfigured, generateStructured, type PromptRef } from "@/lib/gemini";
import { runLogger } from "@/lib/logger";
import { sendToQuarantine, startStage, type StageRun } from "@/lib/run-log";
import { SECTOR_HINTS, ALL_STAGES } from "@/lib/taxonomy";
import { fetchArticle } from "@/pipeline/ingest/article";
import type { StageResult } from "@/pipeline/ingest/collect";
import { extractDealsResponseSchema, extractEventsResponseSchema } from "@/pipeline/schemas";

/**
 * Stage B — Gemini extraction into strict JSON schemas (PRD §10).
 * Input: relevant, unprocessed articles. Output: `extracted_records` rows
 * (status pending) for Stage C/D. Funding and non-funding events use
 * separate prompts and schemas. A batch that fails validation is retried
 * article by article so one bad article cannot sink its neighbours; a single
 * article that still fails is quarantined with the raw model output.
 */

export const DEAL_PROMPT: PromptRef = { name: "extract-deal", version: 1 };
export const EVENT_PROMPT: PromptRef = { name: "extract-event", version: 1 };

interface ArticleRow {
  id: number;
  url: string;
  headline: string | null;
  bodyText: string | null;
  publishedAt: Date | null;
  eventTypeGuess: string | null;
  sourceName: string | null;
  sourceType: string | null;
}

export function sectorList(): string {
  return SECTOR_HINTS.map((s) => `- ${s.name} — e.g. ${s.hints.join(", ")}`).join("\n");
}

export function articlePayload(a: ArticleRow): Record<string, unknown> {
  return {
    article_id: a.id,
    publication: a.sourceName,
    published_at: a.publishedAt ? a.publishedAt.toISOString().slice(0, 10) : null,
    headline: a.headline,
    text: (a.bodyText ?? "").slice(0, PIPELINE.extract.maxCharsPerArticle),
  };
}

/** Fill in thin bodies from the article page (robots-checked), once. */
async function ensureBody(a: ArticleRow): Promise<ArticleRow> {
  if ((a.bodyText?.length ?? 0) >= PIPELINE.extract.minBodyChars) return a;
  try {
    const page = await fetchArticle(a.url);
    if (page.text && page.text.length > (a.bodyText?.length ?? 0)) {
      await getDb()
        .update(rawArticles)
        .set({ bodyText: page.text, publishedAt: a.publishedAt ?? page.publishedAt, updatedAt: new Date() })
        .where(eq(rawArticles.id, a.id));
      return { ...a, bodyText: page.text, publishedAt: a.publishedAt ?? page.publishedAt };
    }
  } catch {
    // Robots-blocked, paywalled or failing pages fall back to the feed text.
  }
  return a;
}

type Kind = "funding" | "event";

async function extractBatch(kind: Kind, batch: ArticleRow[], stage: StageRun) {
  const vars = {
    sectors: sectorList(),
    stages: ALL_STAGES.join(", "),
    articles: JSON.stringify(batch.map(articlePayload), null, 1),
  };
  if (kind === "funding") {
    const r = await generateStructured({
      task: "extract",
      prompt: DEAL_PROMPT,
      vars,
      schema: extractDealsResponseSchema,
      temperature: 0.1,
      counters: stage.counters,
    });
    return { version: r.promptVersion, perArticle: new Map(r.data.articles.map((x) => [x.article_id, x.deals as unknown[]])) };
  }
  const r = await generateStructured({
    task: "extract",
    prompt: EVENT_PROMPT,
    vars,
    schema: extractEventsResponseSchema,
    temperature: 0.1,
    counters: stage.counters,
  });
  return { version: r.promptVersion, perArticle: new Map(r.data.articles.map((x) => [x.article_id, x.events as unknown[]])) };
}

async function persist(kind: Kind, articles: ArticleRow[], result: Awaited<ReturnType<typeof extractBatch>>, runId: string, mode: string) {
  const db = getDb();
  let records = 0;
  for (const a of articles) {
    const items = result.perArticle.get(a.id) ?? [];
    if (items.length) {
      await db
        .insert(extractedRecords)
        .values(
          items.map((payload, i) => ({
            rawArticleId: a.id,
            kind,
            recordIndex: i,
            payload: payload as object,
            promptVersion: result.version,
            // Articles submitted through POST /api/manual-deal keep ingestion_mode = manual.
            ingestionMode: a.sourceType === "manual" ? "manual" : mode,
            runId,
          })),
        )
        .onConflictDoNothing();
      records += items.length;
    }
  }
  await db
    .update(rawArticles)
    .set({ processedAt: new Date(), runId, updatedAt: new Date() })
    .where(inArray(rawArticles.id, articles.map((a) => a.id)));
  return records;
}

export async function runExtract(opts: {
  runId: string;
  cursor: string | null;
  deadline: number;
  ingestionMode?: "live" | "backfill" | "manual";
}): Promise<StageResult> {
  const log = runLogger(opts.runId, "extract");
  const stage = await startStage(opts.runId, "extract");
  if (!geminiConfigured()) {
    // Without a key every call would fail; skip cleanly rather than quarantine articles.
    await stage.finish("partial", { stopReason: "Gemini not configured (GEMINI_API_KEY / GEMINI_MODEL unset)" });
    log.warn("gemini not configured; extract skipped");
    return { processed: 0, next_cursor: null };
  }
  const db = getDb();
  const mode = opts.ingestionMode ?? "live";
  const afterId = opts.cursor ? Number(opts.cursor) : 0;

  const rows = await db
    .select({
      id: rawArticles.id,
      url: rawArticles.url,
      headline: rawArticles.headline,
      bodyText: rawArticles.bodyText,
      publishedAt: rawArticles.publishedAt,
      eventTypeGuess: rawArticles.eventTypeGuess,
      sourceName: sources.name,
      sourceType: sources.type,
    })
    .from(rawArticles)
    .leftJoin(sources, eq(sources.id, rawArticles.sourceId))
    .where(
      and(
        eq(rawArticles.filterVerdict, "relevant"),
        isNull(rawArticles.processedAt),
        gt(rawArticles.id, afterId),
        // Weekly roundups use their own prompt (backfill.ts), never the per-article one.
        ne(rawArticles.eventTypeGuess, "roundup"),
      ),
    )
    .orderBy(asc(rawArticles.id))
    .limit(PIPELINE.extract.maxArticlesPerInvocation);

  let lastId = afterId;
  let records = 0;
  let quarantined = 0;
  let articlesDone = 0;
  let stopReason: string | null = null;

  const groups: Record<Kind, ArticleRow[]> = {
    funding: rows.filter((r) => r.eventTypeGuess === "funding"),
    event: rows.filter((r) => r.eventTypeGuess !== "funding"),
  };

  outer: for (const kind of ["funding", "event"] as const) {
    const list = groups[kind];
    for (let i = 0; i < list.length; i += PIPELINE.extract.batchSize) {
      if (Date.now() > opts.deadline) break outer;
      const batch: ArticleRow[] = [];
      for (const a of list.slice(i, i + PIPELINE.extract.batchSize)) batch.push(await ensureBody(a));
      try {
        records += await persist(kind, batch, await extractBatch(kind, batch, stage), opts.runId, mode);
        articlesDone += batch.length;
      } catch (err) {
        if (err instanceof GeminiUnavailableError) {
          stopReason = err.message;
          log.warn("gemini call failed; extract paused", { error: err.message, status: err.status });
          break outer;
        }
        // Retry one by one so a single malformed article is isolated.
        for (const a of batch) {
          try {
            records += await persist(kind, [a], await extractBatch(kind, [a], stage), opts.runId, mode);
          } catch (inner) {
            if (inner instanceof GeminiUnavailableError) {
              stopReason = inner.message;
              break outer;
            }
            await sendToQuarantine({
              stage: "extract",
              runId: opts.runId,
              rawArticleId: a.id,
              error: inner instanceof Error ? inner.message : String(inner),
              payload: { kind, raw: inner instanceof GeminiOutputError ? inner.rawText : null },
            });
            await db.update(rawArticles).set({ processedAt: new Date(), updatedAt: new Date() }).where(eq(rawArticles.id, a.id));
            quarantined++;
          }
          articlesDone++;
        }
      }
      for (const a of batch) lastId = Math.max(lastId, a.id);
    }
  }

  const exhausted = rows.length < PIPELINE.extract.maxArticlesPerInvocation && articlesDone + quarantined >= rows.length;
  const next_cursor = stopReason !== null || exhausted ? null : String(afterId);
  // Cursor stays at afterId: processed rows drop out of the WHERE clause, so
  // re-querying from the same point picks up exactly the remaining work.

  stage.counters.itemsIn = articlesDone;
  stage.counters.itemsOut = records;
  await stage.finish(stopReason || quarantined ? "partial" : "ok", { records, quarantined, articlesDone, stopReason, lastId });
  log.info("extract chunk done", { records, quarantined, articlesDone });
  return { processed: articlesDone, next_cursor };
}
