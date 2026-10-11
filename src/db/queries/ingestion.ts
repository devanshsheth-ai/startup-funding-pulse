import { asc, desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rawArticles, runLogs, sources } from "@/db/schema";

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
