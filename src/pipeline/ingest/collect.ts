import { and, asc, eq, gt, sql } from "drizzle-orm";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import { rawArticles, sources } from "@/db/schema";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import { RobotsDisallowedError } from "@/lib/http";
import { getParser } from "./parsers";
import type { FetchedItem, SourceRow } from "./types";
import { normalizeUrl, sha256 } from "./url";

/**
 * Ingestion stage. Walks enabled sources in id order from `cursor`, fetches
 * each through its registered parser, and inserts new articles keyed on
 * sha256(normalized url). Re-running inserts nothing new (ON CONFLICT DO
 * NOTHING). One failing source updates its own status and never fails the run.
 */

export interface StageResult {
  processed: number;
  next_cursor: string | null;
  detail?: Record<string, unknown>;
}

export interface SourceOutcome {
  sourceId: number;
  name: string;
  status: "ok" | "empty" | "stale" | "error";
  fetched: number;
  tooOld: number;
  inserted: number;
  duplicates: number;
  error?: string;
}

export function prepareRows(items: FetchedItem[], sourceId: number, runId: string, now: Date) {
  const cutoff = now.getTime() - PIPELINE.collect.liveMaxAgeDays * 86_400_000;
  const seen = new Set<string>();
  const rows: (typeof rawArticles.$inferInsert)[] = [];
  let tooOld = 0;
  for (const item of items) {
    if (item.publishedAt && item.publishedAt.getTime() < cutoff) {
      tooOld++;
      continue;
    }
    let url: string;
    try {
      url = normalizeUrl(item.url);
    } catch {
      continue;
    }
    const hash = sha256(url);
    if (seen.has(hash)) continue;
    seen.add(hash);
    rows.push({
      sourceId,
      url,
      urlHash: hash,
      headline: item.headline,
      author: item.author,
      // Future-dated items are clamped to fetch time rather than trusted.
      publishedAt: item.publishedAt && item.publishedAt > now ? now : item.publishedAt,
      bodyText: item.bodyText,
      categories: item.categories,
      runId,
    });
  }
  return { rows, tooOld };
}

async function collectOne(source: SourceRow, runId: string): Promise<SourceOutcome> {
  const db = getDb();
  const base = { sourceId: source.id, name: source.name, fetched: 0, tooOld: 0, inserted: 0, duplicates: 0 };
  const parser = getParser(source.parser);

  try {
    if (!parser) throw new Error(`No parser registered for key "${source.parser}"`);
    const items = await parser(source);
    const { rows, tooOld } = prepareRows(items, source.id, runId, new Date());

    let inserted = 0;
    for (let i = 0; i < rows.length; i += PIPELINE.collect.insertBatchSize) {
      const batch = rows.slice(i, i + PIPELINE.collect.insertBatchSize);
      const res = await db
        .insert(rawArticles)
        .values(batch)
        .onConflictDoNothing({ target: rawArticles.urlHash })
        .returning({ id: rawArticles.id });
      inserted += res.length;
    }

    // A feed whose every item is past the freshness window is reported as
    // stale rather than "ok", so an empty contribution is explained.
    const stale = items.length > 0 && tooOld === items.length;
    const status = items.length === 0 ? "empty" : stale ? "stale" : "ok";
    await db
      .update(sources)
      .set({
        lastFetchedAt: new Date(),
        lastStatus: status,
        lastError: stale ? `All ${items.length} items older than ${PIPELINE.collect.liveMaxAgeDays} days` : null,
        successCount: sql`${sources.successCount} + 1`,
      })
      .where(eq(sources.id, source.id));

    return { ...base, status, fetched: items.length, tooOld, inserted, duplicates: rows.length - inserted };
  } catch (err) {
    const message =
      err instanceof RobotsDisallowedError
        ? "Blocked by robots.txt"
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);
    await db
      .update(sources)
      .set({
        lastFetchedAt: new Date(),
        lastStatus: "error",
        lastError: message.slice(0, 500),
        failureCount: sql`${sources.failureCount} + 1`,
      })
      .where(eq(sources.id, source.id));
    return { ...base, status: "error", error: message };
  }
}

/**
 * Per-source isolation: collectOne already records fetch/parse failures on the
 * source row; anything that still escapes (a DB hiccup mid-source) becomes an
 * error outcome for that source only, never an aborted collection run.
 */
export async function collectIsolated(source: Pick<SourceRow, "id" | "name">, fn: (s: SourceRow) => Promise<SourceOutcome>): Promise<SourceOutcome> {
  try {
    return await fn(source as SourceRow);
  } catch (err) {
    return { sourceId: source.id, name: source.name, status: "error", fetched: 0, tooOld: 0, inserted: 0, duplicates: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runCollect(opts: {
  runId: string;
  cursor: string | null;
  limit?: number;
  deadline: number;
}): Promise<StageResult> {
  const log = runLogger(opts.runId, "collect");
  const stage = await startStage(opts.runId, "collect");
  const afterId = opts.cursor ? Number(opts.cursor) : 0;
  const limit = opts.limit ?? PIPELINE.collect.defaultLimit;

  const batch = await getDb()
    .select({ id: sources.id, name: sources.name, type: sources.type, url: sources.url, parser: sources.parser, config: sources.config })
    .from(sources)
    .where(and(eq(sources.enabled, true), gt(sources.id, Number.isFinite(afterId) ? afterId : 0)))
    .orderBy(asc(sources.id))
    .limit(limit + 1);

  const outcomes: SourceOutcome[] = [];
  let lastId: number | null = null;
  let stoppedEarly = false;

  for (const source of batch.slice(0, limit)) {
    if (Date.now() > opts.deadline) {
      stoppedEarly = true;
      break;
    }
    const outcome = await collectIsolated(source, (src) => collectOne(src, opts.runId));
    outcomes.push(outcome);
    lastId = source.id;
    log.info("source collected", { ...outcome });
  }

  const more = stoppedEarly || batch.length > limit;
  const next_cursor = more && lastId !== null ? String(lastId) : more ? opts.cursor : null;

  stage.counters.itemsIn = outcomes.reduce((n, o) => n + o.fetched, 0);
  stage.counters.itemsOut = outcomes.reduce((n, o) => n + o.inserted, 0);
  const errors = outcomes.filter((o) => o.status === "error");
  const status = errors.length === 0 ? "ok" : errors.length === outcomes.length && outcomes.length > 0 ? "error" : "partial";
  await stage.finish(status, { cursor: opts.cursor, next_cursor, outcomes });

  return { processed: outcomes.length, next_cursor, detail: { outcomes } };
}
