import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { extractedDealSchema } from "@/pipeline/schemas";
import { extractFunding } from "@/pipeline/extract";
import { fetchArticle } from "@/pipeline/ingest/article";
import { canonicalInvestorName, normalizeCompanyName, normalizeInvestorKey, resolveStage } from "@/pipeline/normalize";
import { sha256, normalizeUrl } from "@/pipeline/ingest/url";
import { goldenFileSchema, scoreGoldenCase, summariseGolden } from "@/pipeline/golden";

/**
 * Golden-file extraction check (PRD §25) — run on every prompt change:
 *   npm run golden
 * Re-extracts 20 real articles with the current funding prompt and compares
 * against fields that two or more publications agreed on. Article text comes
 * from the database (or a robots-respecting re-fetch), never from the repo.
 * Exits non-zero when accuracy drops below the thresholds in pipeline/golden.ts.
 */
async function main(): Promise<void> {
  const file = goldenFileSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "golden-funding.json"), "utf8")));
  const db = getDb();
  const articles: { id: number; url: string; headline: string | null; bodyText: string | null; publishedAt: Date | null; sourceName: string | null }[] = [];
  for (const [i, c] of file.cases.entries()) {
    const hash = sha256(normalizeUrl(c.article.url));
    const row = z
      .array(z.object({ body_text: z.string().nullable(), published_at: z.coerce.date().nullable() }))
      .parse((await db.execute(sql`SELECT body_text, published_at FROM raw_articles WHERE url_hash = ${hash}`)).rows)[0];
    let body = row?.body_text ?? null;
    if (!body || body.length < 400) body = (await fetchArticle(c.article.url).catch(() => null))?.text ?? body;
    articles.push({ id: i + 1, url: c.article.url, headline: c.article.headline, bodyText: body, publishedAt: row?.published_at ?? null, sourceName: c.article.publication });
  }
  const { promptVersion, perArticle } = await extractFunding(articles);
  const results = file.cases.map((c, i) => {
    const extracted = (perArticle.get(i + 1) ?? []).flatMap((p) => {
      const r = extractedDealSchema.safeParse(p);
      return r.success ? [r.data] : [];
    });
    return scoreGoldenCase(c, extracted, { normalizeCompanyName, normalizeInvestorKey, canonicalInvestorName, resolveStage });
  });
  const summary = summariseGolden(results);
  for (const r of results) logger.info("golden case", { ...r });
  logger.info("golden summary", { promptVersion, ...summary });
  if (!summary.pass) process.exit(1);
}
main().catch((err: unknown) => {
  logger.error("golden run failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
