import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { parse } from "node-html-parser";
import { z } from "zod";
import { getDb } from "@/db/client";
import { companies, deals, extractedRecords, rawArticles, sources } from "@/db/schema";
import { GeminiOutputError, GeminiUnavailableError, generateStructured, type PromptRef } from "@/lib/gemini";
import { fetchText } from "@/lib/http";
import { runLogger } from "@/lib/logger";
import { sendToQuarantine, startStage } from "@/lib/run-log";
import { ALL_STAGES } from "@/lib/taxonomy";
import { sectorList } from "@/pipeline/extract";
import { fetchArticle } from "@/pipeline/ingest/article";
import { parseFeedXml } from "@/pipeline/ingest/parsers/rss";
import { normalizeUrl, sha256 } from "@/pipeline/ingest/url";
import { isoWeek, normalizeCompanyName, resolveAnnouncedDate, toIsoDate } from "@/pipeline/normalize";
import { extractRoundupResponseSchema } from "@/pipeline/schemas";

/**
 * M4 backfill (PRD §19). Weekly funding roundups give ~20–30 deals per
 * article, so ~13 weeks × 2 publications reconstruct the baseline history
 * that daily RSS (10–50 recent items) cannot. Every record is tagged
 * ingestion_mode = 'backfill' and flows through the same Stage C/D/E code.
 */

export const ROUNDUP_PROMPT: PromptRef = { name: "extract-roundup", version: 1 };

export const roundupConfigSchema = z.object({
  /** "rss_feed": dated feed of roundup posts; "listing": archive pages with week ranges in slugs. */
  discovery: z.enum(["rss_feed", "listing"]),
  /** Regex a roundup's headline (rss_feed) or path (listing) must match. */
  match: z.string().min(1),
  /** Additional archive URLs to scan (listing). */
  extraListings: z.array(z.string().url()).default([]),
  /** Archive pages per listing to scan (page 1 = the base URL; ?page=N after). */
  pages: z.number().int().min(1).max(5).default(1),
});
export type RoundupConfig = z.infer<typeof roundupConfigSchema>;

export interface RoundupRef {
  url: string;
  headline: string | null;
  /** Last day of the week the roundup covers (YYYY-MM-DD). */
  weekEnd: string;
  weekLabel: string;
}

// ─── Discovery ─────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * "…this-week-oct-5-oct-10-12662210" → week end 2026-10-10. The year is not
 * in the slug: pick the latest year that does not put the date in the future.
 */
export function weekFromSlug(path: string, today: string): { start: string; end: string } | null {
  const m = /([a-z]+)-(\d{1,2})-([a-z]+)-(\d{1,2})-\d{5,}\/?$/.exec(path.toLowerCase());
  if (!m) return null;
  const [, m1, d1, m2, d2] = m;
  const mo1 = MONTHS[m1 ?? ""];
  const mo2 = MONTHS[m2 ?? ""];
  if (!mo1 || !mo2) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  let year = Number(today.slice(0, 4));
  let end = `${year}-${pad(mo2)}-${pad(Number(d2))}`;
  if (end > today) {
    year -= 1;
    end = `${year}-${pad(mo2)}-${pad(Number(d2))}`;
  }
  const startYear = mo1 > mo2 ? year - 1 : year; // "dec-29-jan-3"
  const start = `${startYear}-${pad(mo1)}-${pad(Number(d1))}`;
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  return { start, end };
}

async function discoverFromFeed(feedUrl: string, cfg: RoundupConfig): Promise<RoundupRef[]> {
  const { text } = await fetchText(feedUrl, { headers: { Accept: "application/rss+xml, application/xml" } });
  const re = new RegExp(cfg.match, "i");
  return parseFeedXml(text)
    .filter((i) => i.publishedAt && re.test(i.headline ?? ""))
    .map((i) => {
      const end = toIsoDate(i.publishedAt as Date);
      return { url: i.url, headline: i.headline, weekEnd: end, weekLabel: `week ending ${end}` };
    });
}

async function discoverFromListings(baseUrl: string, cfg: RoundupConfig, today: string): Promise<RoundupRef[]> {
  const re = new RegExp(cfg.match, "i");
  const found = new Map<string, RoundupRef>();
  for (const listing of [baseUrl, ...cfg.extraListings]) {
    for (let page = 1; page <= cfg.pages; page++) {
      const url = page === 1 ? listing : `${listing}?page=${page}`;
      let html: string;
      try {
        html = (await fetchText(url, { headers: { Accept: "text/html" } })).text;
      } catch {
        continue; // a missing archive page degrades discovery, never fails it
      }
      for (const a of parse(html).querySelectorAll("a[href]")) {
        const href = a.getAttribute("href");
        if (!href) continue;
        let abs: URL;
        try {
          abs = new URL(href, url);
        } catch {
          continue;
        }
        if (!re.test(abs.pathname)) continue;
        const week = weekFromSlug(abs.pathname, today);
        if (!week) continue;
        const key = normalizeUrl(abs.toString());
        if (!found.has(key)) {
          const headline = a.textContent.replace(/\s+/g, " ").trim() || null;
          found.set(key, { url: key, headline, weekEnd: week.end, weekLabel: `${week.start} to ${week.end}` });
        }
      }
    }
  }
  return [...found.values()];
}

export async function discoverRoundups(
  source: { url: string; config: unknown },
  opts: { weeks: number; today: string },
): Promise<RoundupRef[]> {
  const cfg = roundupConfigSchema.parse(source.config);
  const refs = cfg.discovery === "rss_feed" ? await discoverFromFeed(source.url, cfg) : await discoverFromListings(source.url, cfg, opts.today);
  // One roundup per ISO week (both category archives can list the same week).
  const byWeek = new Map<string, RoundupRef>();
  for (const r of refs.sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))) {
    const wk = isoWeek(r.weekEnd);
    if (!byWeek.has(wk)) byWeek.set(wk, r);
  }
  return [...byWeek.values()].slice(0, opts.weeks);
}

// ─── Ingest ────────────────────────────────────────────────────────────────

/** Fetch each roundup and store it as a raw article (idempotent on url_hash). */
export async function ingestRoundups(sourceId: number, refs: RoundupRef[], runId: string): Promise<{ stored: number; failed: string[] }> {
  const db = getDb();
  let stored = 0;
  const failed: string[] = [];
  for (const r of refs) {
    const hash = sha256(normalizeUrl(r.url));
    const [existing] = await db.select({ id: rawArticles.id }).from(rawArticles).where(eq(rawArticles.urlHash, hash)).limit(1);
    if (existing) continue;
    try {
      const page = await fetchArticle(r.url);
      if (!page.text || page.text.length < 500) throw new Error("roundup body too short to extract");
      await db
        .insert(rawArticles)
        .values({
          sourceId,
          url: normalizeUrl(r.url),
          urlHash: hash,
          headline: r.headline,
          // The roundup's own date, else the end of the week it covers.
          publishedAt: page.publishedAt ?? new Date(`${r.weekEnd}T12:00:00Z`),
          bodyText: page.text,
          categories: ["roundup", `week:${r.weekLabel}`],
          filterVerdict: "relevant",
          eventTypeGuess: "roundup",
          runId,
        })
        .onConflictDoNothing();
      stored++;
    } catch (err) {
      failed.push(`${r.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { stored, failed };
}

// ─── Extract (one Gemini call per roundup) ─────────────────────────────────

export async function extractRoundups(runId: string): Promise<{ roundups: number; deals: number; events: number; quarantined: number; stopReason: string | null }> {
  const log = runLogger(runId, "backfill_extract");
  const stage = await startStage(runId, "backfill_extract");
  const db = getDb();
  const pending = await db
    .select({ id: rawArticles.id, headline: rawArticles.headline, bodyText: rawArticles.bodyText, publishedAt: rawArticles.publishedAt, categories: rawArticles.categories, publication: sources.name })
    .from(rawArticles)
    .innerJoin(sources, eq(sources.id, rawArticles.sourceId))
    .where(and(eq(rawArticles.eventTypeGuess, "roundup"), isNull(rawArticles.processedAt)))
    .orderBy(asc(rawArticles.id));

  let deals_ = 0;
  let events_ = 0;
  let quarantined = 0;
  let roundups = 0;
  let stopReason: string | null = null;

  for (const a of pending) {
    const week = a.categories?.find((c) => c.startsWith("week:"))?.slice(5) ?? "unknown week";
    try {
      const { data, promptVersion } = await generateStructured({
        task: "extract",
        prompt: ROUNDUP_PROMPT,
        vars: {
          week,
          publication: a.publication,
          stages: ALL_STAGES.join(", "),
          sectors: sectorList(),
          article: `${a.headline ?? ""}\n\n${(a.bodyText ?? "").slice(0, 24_000)}`,
        },
        schema: extractRoundupResponseSchema,
        temperature: 0.1,
        counters: stage.counters,
        maxOutputTokens: 32_768,
      });
      const rows = [
        ...data.deals.map((p, i) => ({ kind: "funding", recordIndex: i, payload: p })),
        ...data.events.map((p, i) => ({ kind: "event", recordIndex: i, payload: p })),
      ];
      if (rows.length) {
        await db
          .insert(extractedRecords)
          .values(rows.map((r) => ({ ...r, rawArticleId: a.id, payload: r.payload as object, promptVersion, ingestionMode: "backfill", runId })))
          .onConflictDoNothing();
      }
      await db.update(rawArticles).set({ processedAt: new Date(), updatedAt: new Date() }).where(eq(rawArticles.id, a.id));
      deals_ += data.deals.length;
      events_ += data.events.length;
      roundups++;
      log.info("roundup extracted", { raw_article_id: a.id, week, deals: data.deals.length, events: data.events.length });
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        stopReason = err.message;
        break;
      }
      await sendToQuarantine({
        stage: "backfill_extract",
        runId,
        rawArticleId: a.id,
        error: err instanceof Error ? err.message : String(err),
        payload: { raw: err instanceof GeminiOutputError ? err.rawText : null },
      });
      await db.update(rawArticles).set({ processedAt: new Date(), updatedAt: new Date() }).where(eq(rawArticles.id, a.id));
      quarantined++;
    }
  }
  stage.counters.itemsIn = roundups + quarantined;
  stage.counters.itemsOut = deals_ + events_;
  await stage.finish(stopReason || quarantined ? "partial" : "ok", { roundups, deals: deals_, events: events_, quarantined, stopReason });
  return { roundups, deals: deals_, events: events_, quarantined, stopReason };
}

// ─── Cross-check (PRD §19.3 step 4) ────────────────────────────────────────

export interface CrossCheck {
  weeks: string[];
  liveCompanies: number;
  roundupCompanies: number;
  overlap: number;
  /** Share of live-collected deals the roundups also contain. */
  roundupRecallOfLive: number | null;
  /** Share of roundup deals that live collection also caught. */
  liveRecallOfRoundup: number | null;
  liveOnly: string[];
  roundupOnly: string[];
}

/**
 * Compare, for the most recent N roundup weeks, the companies extracted from
 * roundups with those collected live. Overlap is evidence that roundup
 * extraction finds real deals (and how much live RSS alone misses).
 */
export async function crossCheck(runId: string, weeksBack = 3): Promise<CrossCheck> {
  const db = getDb();
  const today = toIsoDate(new Date());
  const recs = await db
    .select({ payload: extractedRecords.payload, publishedAt: rawArticles.publishedAt })
    .from(extractedRecords)
    .innerJoin(rawArticles, eq(rawArticles.id, extractedRecords.rawArticleId))
    .where(and(eq(extractedRecords.ingestionMode, "backfill"), eq(extractedRecords.kind, "funding")));

  const roundupByWeek = new Map<string, Set<string>>();
  for (const r of recs) {
    const p = r.payload as { company_name?: string; announced_date?: string | null };
    if (!p.company_name) continue;
    const date = resolveAnnouncedDate(p.announced_date ?? null, r.publishedAt, new Date());
    if (!date || date > today) continue;
    const wk = isoWeek(date);
    const set = roundupByWeek.get(wk) ?? new Set<string>();
    set.add(normalizeCompanyName(p.company_name));
    roundupByWeek.set(wk, set);
  }
  const weeks = [...roundupByWeek.keys()].sort().reverse().slice(0, weeksBack);

  const live = weeks.length
    ? await db
        .select({ name: companies.normalizedName })
        .from(deals)
        .innerJoin(companies, eq(companies.id, deals.companyId))
        .where(and(eq(deals.ingestionMode, "live"), inArray(deals.isoWeek, weeks)))
    : [];
  const liveSet = new Set(live.map((l) => l.name));
  const roundupSet = new Set(weeks.flatMap((w) => [...(roundupByWeek.get(w) ?? [])]));
  const overlap = [...liveSet].filter((n) => roundupSet.has(n));

  const result: CrossCheck = {
    weeks,
    liveCompanies: liveSet.size,
    roundupCompanies: roundupSet.size,
    overlap: overlap.length,
    roundupRecallOfLive: liveSet.size ? overlap.length / liveSet.size : null,
    liveRecallOfRoundup: roundupSet.size ? overlap.length / roundupSet.size : null,
    liveOnly: [...liveSet].filter((n) => !roundupSet.has(n)).sort(),
    roundupOnly: [...roundupSet].filter((n) => !liveSet.has(n)).sort(),
  };
  const stage = await startStage(runId, "backfill_crosscheck");
  stage.counters.itemsIn = result.liveCompanies + result.roundupCompanies;
  stage.counters.itemsOut = result.overlap;
  await stage.finish("ok", { ...result });
  return result;
}

