import { asc, desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { deals, events, extractedRecords, quarantine, rawArticles, runLogs, sources } from "@/db/schema";

/** Read models for /health: per-source status, article totals, run log tail. */

export interface SourceHealth {
  id: number;
  name: string;
  type: string;
  tier: number;
  enabled: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastFetchedAt: Date | null;
  successCount: number;
  failureCount: number;
  /** null when the source has never been attempted (n = 0). */
  successRate: number | null;
  attempts: number;
  articles: number;
  articles24h: number;
}

export async function getSourceHealth(): Promise<SourceHealth[]> {
  const db = getDb();
  const counts = db
    .select({
      sourceId: rawArticles.sourceId,
      articles: sql<number>`count(*)::int`.as("articles"),
      articles24h: sql<number>`count(*) filter (where ${rawArticles.fetchedAt} > now() - interval '24 hours')::int`.as(
        "articles_24h",
      ),
    })
    .from(rawArticles)
    .groupBy(rawArticles.sourceId)
    .as("counts");

  const rows = await db
    .select({
      id: sources.id,
      name: sources.name,
      type: sources.type,
      tier: sources.tier,
      enabled: sources.enabled,
      lastStatus: sources.lastStatus,
      lastError: sources.lastError,
      lastFetchedAt: sources.lastFetchedAt,
      successCount: sources.successCount,
      failureCount: sources.failureCount,
      articles: sql<number>`coalesce(${counts.articles}, 0)::int`,
      articles24h: sql<number>`coalesce(${counts.articles24h}, 0)::int`,
    })
    .from(sources)
    .leftJoin(counts, sql`${counts.sourceId} = ${sources.id}`)
    .orderBy(asc(sources.tier), desc(sources.enabled), asc(sources.name));

  return rows.map((r) => {
    const attempts = r.successCount + r.failureCount;
    return { ...r, attempts, successRate: attempts === 0 ? null : r.successCount / attempts };
  });
}

export interface ArticleTotals {
  total: number;
  last24h: number;
  sourcesWithArticles: number;
  pendingFilter: number;
  oldestPublished: Date | null;
  newestPublished: Date | null;
}

export async function getArticleTotals(): Promise<ArticleTotals> {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      last24h: sql<number>`count(*) filter (where ${rawArticles.fetchedAt} > now() - interval '24 hours')::int`,
      sourcesWithArticles: sql<number>`count(distinct ${rawArticles.sourceId})::int`,
      pendingFilter: sql<number>`count(*) filter (where ${rawArticles.filterVerdict} = 'pending')::int`,
      oldestPublished: sql<Date | null>`min(${rawArticles.publishedAt})`,
      newestPublished: sql<Date | null>`max(${rawArticles.publishedAt})`,
    })
    .from(rawArticles);
  return (
    row ?? { total: 0, last24h: 0, sourcesWithArticles: 0, pendingFilter: 0, oldestPublished: null, newestPublished: null }
  );
}

export async function getRunLogTail(limit = 20) {
  return getDb()
    .select({
      runId: runLogs.runId,
      stage: runLogs.stage,
      status: runLogs.status,
      startedAt: runLogs.startedAt,
      finishedAt: runLogs.finishedAt,
      itemsIn: runLogs.itemsIn,
      itemsOut: runLogs.itemsOut,
      geminiCalls: runLogs.geminiCalls,
      geminiTokens: runLogs.geminiTokens,
      error: runLogs.error,
    })
    .from(runLogs)
    .orderBy(desc(runLogs.startedAt))
    .limit(limit);
}

export async function getLastSuccessfulCollect(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: sql<Date | null>`max(${runLogs.finishedAt})` })
    .from(runLogs)
    .where(sql`${runLogs.stage} = 'collect' and ${runLogs.status} in ('ok', 'partial')`);
  return row?.at ? new Date(row.at) : null;
}

export interface PipelineFunnel {
  articles: number;
  relevant: number;
  fundingArticles: number;
  candidateDeals: number;
  rejectedCandidates: number;
  uniqueDeals: number;
  /** 1 − unique/candidates; null when there are no candidates (n = 0). */
  dedupeReduction: number | null;
  multiSourceDeals: number;
  events: number;
  dealsByMode: { mode: string; n: number }[];
  eventsByMode: { mode: string; n: number }[];
  quarantineByStage: { stage: string; n: number }[];
  gemini24h: { calls: number; tokens: number };
  dealWeeks: number;
  earliestDeal: string | null;
  latestDeal: string | null;
}

export async function getPipelineFunnel(): Promise<PipelineFunnel> {
  const db = getDb();
  const one = async <T>(q: Promise<T[]>): Promise<T | undefined> => (await q)[0];
  const [art, cand, dl, ev, gem] = await Promise.all([
    one(
      db.select({
        articles: sql<number>`count(*)::int`,
        relevant: sql<number>`count(*) filter (where filter_verdict = 'relevant')::int`,
        funding: sql<number>`count(*) filter (where filter_verdict = 'relevant' and event_type_guess = 'funding')::int`,
      }).from(rawArticles),
    ),
    one(
      db.select({
        candidates: sql<number>`count(*) filter (where kind = 'funding')::int`,
        rejected: sql<number>`count(*) filter (where kind = 'funding' and status = 'rejected')::int`,
      }).from(extractedRecords),
    ),
    one(
      db.select({
        n: sql<number>`count(*)::int`,
        multi: sql<number>`count(*) filter (where corroboration_count >= 2)::int`,
        weeks: sql<number>`count(distinct iso_week)::int`,
        earliest: sql<string | null>`min(announced_date)::text`,
        latest: sql<string | null>`max(announced_date)::text`,
      }).from(deals),
    ),
    one(db.select({ n: sql<number>`count(*)::int` }).from(events)),
    one(
      db.select({
        calls: sql<number>`coalesce(sum(gemini_calls), 0)::int`,
        tokens: sql<number>`coalesce(sum(gemini_tokens), 0)::int`,
      }).from(runLogs).where(sql`${runLogs.startedAt} > now() - interval '24 hours'`),
    ),
  ]);
  const [dealsByMode, eventsByMode, quarantineByStage] = await Promise.all([
    db.select({ mode: deals.ingestionMode, n: sql<number>`count(*)::int` }).from(deals).groupBy(deals.ingestionMode),
    db.select({ mode: events.ingestionMode, n: sql<number>`count(*)::int` }).from(events).groupBy(events.ingestionMode),
    db.select({ stage: quarantine.stage, n: sql<number>`count(*)::int` }).from(quarantine).groupBy(quarantine.stage),
  ]);
  const candidates = (cand?.candidates ?? 0) - (cand?.rejected ?? 0);
  const unique = dl?.n ?? 0;
  return {
    articles: art?.articles ?? 0,
    relevant: art?.relevant ?? 0,
    fundingArticles: art?.funding ?? 0,
    candidateDeals: candidates,
    rejectedCandidates: cand?.rejected ?? 0,
    uniqueDeals: unique,
    dedupeReduction: candidates > 0 ? 1 - unique / candidates : null,
    multiSourceDeals: dl?.multi ?? 0,
    events: ev?.n ?? 0,
    dealsByMode,
    eventsByMode,
    quarantineByStage,
    gemini24h: { calls: gem?.calls ?? 0, tokens: gem?.tokens ?? 0 },
    dealWeeks: dl?.weeks ?? 0,
    earliestDeal: dl?.earliest ?? null,
    latestDeal: dl?.latest ?? null,
  };
}
