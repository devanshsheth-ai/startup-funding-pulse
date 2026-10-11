import { sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { rawArticles, sources } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { RobotsDisallowedError } from "@/lib/http";
import { logger, newRunId } from "@/lib/logger";
import { fetchArticle } from "@/pipeline/ingest/article";
import { normalizeUrl, sha256 } from "@/pipeline/ingest/url";

/**
 * POST /api/manual-deal { url } — submit a real article the feeds missed
 * (PRD §22). The article is fetched (robots.txt respected) and queued as a
 * raw article; the normal filter → extract → dedupe stages turn it into a deal
 * with ingestion_mode = manual. No deal fields are typed in by hand, so every
 * manual record still traces to a fetched source (CLAUDE.md §0.2).
 */
export const maxDuration = 30;
const body = z.object({ url: z.string().url().max(2000).refine((u) => /^https?:\/\//.test(u), "http(s) only") });
const MANUAL_SOURCE_URL = "manual://submissions";

export async function POST(req: NextRequest): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "a valid article url is required" }, { status: 400 });
  const db = getDb();
  try {
    const url = normalizeUrl(parsed.data.url);
    const article = await fetchArticle(url);
    if (!article.text || article.text.length < 200) return Response.json({ ok: false, error: "Could not read article text from that page." }, { status: 422 });
    const [src] = await db
      .insert(sources)
      .values({ name: "Manual submissions", type: "manual", url: MANUAL_SOURCE_URL, tier: 3, parser: "manual", enabled: false, lastStatus: "manual" })
      .onConflictDoUpdate({ target: sources.url, set: { updatedAt: new Date() } })
      .returning({ id: sources.id });
    const canonical = article.canonicalUrl ? normalizeUrl(article.canonicalUrl) : url;
    const headline = article.text.split("\n").find((l) => l.trim().length > 20)?.trim().slice(0, 300) ?? null;
    const res = await db
      .insert(rawArticles)
      .values({ sourceId: src?.id ?? null, url: canonical, urlHash: sha256(canonical), headline, publishedAt: article.publishedAt, bodyText: article.text, runId: newRunId() })
      .onConflictDoNothing({ target: rawArticles.urlHash })
      .returning({ id: rawArticles.id });
    if (res.length === 0) {
      const [dup] = (await db.execute(sql`SELECT id, filter_verdict FROM raw_articles WHERE url_hash = ${sha256(canonical)}`)).rows as { id: number; filter_verdict: string }[];
      return Response.json({ ok: true, queued: false, raw_article_id: dup?.id ?? null, note: `Already collected (filter verdict: ${dup?.filter_verdict ?? "unknown"}).` });
    }
    return Response.json({ ok: true, queued: true, raw_article_id: res[0]?.id ?? null, note: "Queued; the next pipeline run classifies and extracts it." });
  } catch (err) {
    if (err instanceof RobotsDisallowedError) return Response.json({ ok: false, error: "That site's robots.txt disallows fetching this page." }, { status: 422 });
    logger.error("manual deal failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "Could not fetch that article." }, { status: 502 });
  }
}
