import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import {
  companies,
  dealInvestors,
  deals,
  dealSources,
  EMBEDDING_DIMENSIONS,
  events,
  eventSources,
  extractedRecords,
  investors,
  rawArticles,
  sources,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { refreshFxRange, rateOnOrBefore, type FxRate } from "@/lib/fx";
import { embedTexts, GeminiUnavailableError, generateStructured } from "@/lib/gemini";
import { runLogger, type Logger } from "@/lib/logger";
import { startStage, type StageCounters } from "@/lib/run-log";
import type { StageResult } from "@/pipeline/ingest/collect";
import { mergeReports, type SourceReport } from "@/pipeline/merge";
import {
  buildDealCandidate,
  buildEventCandidate,
  dealId as makeDealId,
  eventId as makeEventId,
  normalizeCompanyName,
  normalizeInvestorKey,
  resolveAnnouncedDate,
  toIsoDate,
  type DealCandidate,
  type EventCandidate,
} from "@/pipeline/normalize";
import { extractedDealSchema, extractedEventSchema } from "@/pipeline/schemas";

/**
 * Stages C + D — normalise each pending extraction, then resolve it to an
 * existing deal or create a new one (PRD §10 Stage D). Four layers, stopping
 * at the first confident match:
 *   1. domain + compatible stage + ±14 days
 *   2. normalised name + compatible stage + ±14 days
 *   3. company-embedding cosine ≥ 0.88 + compatible stage + ±14 days
 *   4. Gemini adjudication for cosine 0.78–0.88 or name trigram > 0.7
 * On attach, the deal row is recomputed from all of its sources (merge.ts).
 * All writes are idempotent (ON CONFLICT + recompute), so a partially failed
 * invocation converges on the next run.
 */

const W = PIPELINE.dedupe;

// ─── FX lookup with on-demand backfill ─────────────────────────────────────

const fxMemo = new Map<string, FxRate | null>();

export async function fxForDate(date: string): Promise<FxRate | null> {
  if (fxMemo.has(date)) return fxMemo.get(date) ?? null;
  let rate = await rateOnOrBefore(date);
  const stale = !rate || Date.parse(date) - Date.parse(rate.date) > 7 * 86_400_000;
  if (stale) {
    try {
      const from = toIsoDate(new Date(Date.parse(date) - 14 * 86_400_000));
      await refreshFxRange(from, date);
      rate = await rateOnOrBefore(date);
    } catch {
      // Keep whatever we had; the amount stays unconverted rather than guessed.
    }
  }
  fxMemo.set(date, rate);
  return rate;
}

// ─── Embeddings (optional until the key is configured) ─────────────────────

export function companyEmbeddingText(c: { companyName: string; description: string | null; subSector: string | null; businessModel: string | null; sectorPrimary: string }): string {
  return [c.companyName, c.description, c.subSector, c.businessModel, c.sectorPrimary].filter(Boolean).join(" · ");
}

function embeddingsAvailable(): boolean {
  const env = getEnv();
  return !!env.GEMINI_API_KEY && !!env.GEMINI_EMBEDDING_MODEL;
}

const vec = (v: number[]) => `[${v.join(",")}]`;

// ─── Matching ──────────────────────────────────────────────────────────────

const stageClause = (stage: string) =>
  sql`(${deals.roundStage} = ${stage} OR ${deals.roundStage} = 'Undisclosed' OR ${stage} = 'Undisclosed')`;
const windowClause = (date: string) =>
  sql`${deals.announcedDate} BETWEEN (${date}::date - ${W.windowDays}::int) AND (${date}::date + ${W.windowDays}::int)`;
const proximity = (date: string) => sql`abs(${deals.announcedDate} - ${date}::date)`;

export interface MatchResult {
  dealId: string;
  layer: 1 | 2 | 3 | 4;
  detail: string;
}

const adjudicationSchema = z.object({
  same_event: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
});

async function describeDeal(id: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [d] = await db
    .select({
      company: companies.canonicalName,
      description: companies.description,
      city: deals.hqCity,
      stage: deals.roundStage,
      amountUsd: deals.amountUsd,
      announced: deals.announcedDate,
      sector: deals.sectorPrimary,
    })
    .from(deals)
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .where(eq(deals.id, id));
  const leads = await db
    .select({ name: investors.canonicalName })
    .from(dealInvestors)
    .innerJoin(investors, eq(investors.id, dealInvestors.investorId))
    .where(and(eq(dealInvestors.dealId, id), eq(dealInvestors.role, "lead")));
  return { ...d, lead_investors: leads.map((l) => l.name) };
}

export async function findMatch(
  c: DealCandidate,
  embedding: number[] | null,
  counters: StageCounters,
): Promise<MatchResult | null> {
  const db = getDb();
  const base = and(stageClause(c.roundStage), windowClause(c.announcedDate));

  if (c.domain) {
    const [hit] = await db
      .select({ id: deals.id })
      .from(deals)
      .innerJoin(companies, eq(companies.id, deals.companyId))
      .where(and(eq(companies.domain, c.domain), base))
      .orderBy(proximity(c.announcedDate))
      .limit(1);
    if (hit) return { dealId: hit.id, layer: 1, detail: `domain ${c.domain}` };
  }

  const [byName] = await db
    .select({ id: deals.id })
    .from(deals)
    .innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(eq(companies.normalizedName, c.normalizedName), base))
    .orderBy(proximity(c.announcedDate))
    .limit(1);
  if (byName) return { dealId: byName.id, layer: 2, detail: `name "${c.normalizedName}"` };

  // Layers 3–4 candidates: similar embedding OR similar name, same window/stage.
  const simExpr = embedding ? sql<number>`1 - (${companies.embedding} <=> ${vec(embedding)}::vector)` : sql<number>`0`;
  const trgmExpr = sql<number>`similarity(${companies.normalizedName}, ${c.normalizedName})`;
  const near = await db
    .select({ id: deals.id, sim: simExpr, trgm: trgmExpr })
    .from(deals)
    .innerJoin(companies, eq(companies.id, deals.companyId))
    .where(
      and(
        base,
        embedding
          ? sql`(${companies.embedding} IS NOT NULL AND 1 - (${companies.embedding} <=> ${vec(embedding)}::vector) >= ${W.vectorLow}) OR ${trgmExpr} > ${W.trigram}`
          : sql`${trgmExpr} > ${W.trigram}`,
      ),
    )
    .orderBy(sql`greatest(${simExpr}, ${trgmExpr}) DESC`)
    .limit(W.maxAdjudicationsPerCandidate);

  const strong = near.find((n) => Number(n.sim) >= W.vectorSame);
  if (strong) return { dealId: strong.id, layer: 3, detail: `cosine ${Number(strong.sim).toFixed(3)}` };

  if (near.length && getEnv().GEMINI_API_KEY && getEnv().GEMINI_MODEL) {
    const recordB = {
      company: c.companyName,
      description: c.description,
      city: c.hqCity,
      stage: c.roundStage,
      amountUsd: c.amount?.amountUsd ?? null,
      announced: c.announcedDate,
      sector: c.sectorPrimary,
      lead_investors: c.investors.lead,
    };
    for (const n of near) {
      const { data } = await generateStructured({
        task: "adjudicate",
        prompt: { name: "dedupe-adjudicate", version: 1 },
        vars: { record_a: JSON.stringify(await describeDeal(n.id), null, 1), record_b: JSON.stringify(recordB, null, 1) },
        schema: adjudicationSchema,
        temperature: 0.1,
        counters,
      });
      if (data.same_event && data.confidence >= W.adjudicateMinConfidence) {
        return { dealId: n.id, layer: 4, detail: `adjudicated (${data.confidence.toFixed(2)}): ${data.reason}` };
      }
    }
  }
  return null;
}

// ─── Companies and investors ───────────────────────────────────────────────

export async function resolveCompany(
  c: {
    companyName: string;
    normalizedName: string;
    aliases?: string[];
    domain?: string | null;
    description?: string | null;
    sectorPrimary?: string | null;
    subSector?: string | null;
    businessModel?: string | null;
    hqCity?: string | null;
    foundedYear?: number | null;
  },
  seenAt: string,
  embedding: number[] | null = null,
): Promise<number> {
  const db = getDb();
  let id: number | undefined;
  if (c.domain) {
    id = (await db.select({ id: companies.id }).from(companies).where(eq(companies.domain, c.domain)).limit(1))[0]?.id;
  }
  if (id === undefined) {
    id = (
      await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.normalizedName, c.normalizedName))
        .orderBy(sql`(${companies.hqCity} IS NOT DISTINCT FROM ${c.hqCity ?? null}) DESC`, asc(companies.id))
        .limit(1)
    )[0]?.id;
  }
  const seen = new Date(`${seenAt}T00:00:00Z`);
  if (id === undefined) {
    const inserted = await db
      .insert(companies)
      .values({
        canonicalName: c.companyName,
        normalizedName: c.normalizedName,
        aliases: c.aliases ?? [],
        domain: c.domain ?? null,
        description: c.description ?? null,
        sectorPrimary: c.sectorPrimary ?? null,
        subSector: c.subSector ?? null,
        businessModel: c.businessModel ?? null,
        hqCity: c.hqCity ?? null,
        foundedYear: c.foundedYear ?? null,
        embedding,
        firstSeenAt: seen,
        lastEventAt: seen,
      })
      .onConflictDoNothing()
      .returning({ id: companies.id });
    id =
      inserted[0]?.id ??
      (await db.select({ id: companies.id }).from(companies).where(eq(companies.normalizedName, c.normalizedName)).limit(1))[0]?.id;
    if (id === undefined) throw new Error(`could not resolve company "${c.companyName}"`);
    return id;
  }
  // Fill blanks only; never overwrite an existing value with a newer guess.
  await db
    .update(companies)
    .set({
      domain: sql`coalesce(${companies.domain}, ${c.domain ?? null})`,
      description: sql`coalesce(${companies.description}, ${c.description ?? null})`,
      sectorPrimary: sql`coalesce(${companies.sectorPrimary}, ${c.sectorPrimary ?? null})`,
      subSector: sql`coalesce(${companies.subSector}, ${c.subSector ?? null})`,
      businessModel: sql`coalesce(${companies.businessModel}, ${c.businessModel ?? null})`,
      hqCity: sql`coalesce(${companies.hqCity}, ${c.hqCity ?? null})`,
      foundedYear: sql`coalesce(${companies.foundedYear}, ${c.foundedYear ?? null})`,
      embedding: embedding ? sql`coalesce(${companies.embedding}, ${vec(embedding)}::vector)` : companies.embedding,
      aliases: sql`(SELECT array_agg(DISTINCT a) FROM unnest(coalesce(${companies.aliases}, '{}') || ${c.aliases ?? []}::text[]) a)`,
      firstSeenAt: sql`least(${companies.firstSeenAt}, ${seen})`,
      lastEventAt: sql`greatest(${companies.lastEventAt}, ${seen})`,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, id));
  return id;
}

async function upsertInvestor(name: string, seenAt: string): Promise<number> {
  const seen = new Date(`${seenAt}T00:00:00Z`);
  const [row] = await getDb()
    .insert(investors)
    .values({ canonicalName: name, normalizedName: normalizeInvestorKey(name), aliases: [], firstSeenAt: seen })
    .onConflictDoUpdate({
      target: investors.canonicalName,
      set: { firstSeenAt: sql`least(${investors.firstSeenAt}, excluded.first_seen_at)`, updatedAt: new Date() },
    })
    .returning({ id: investors.id });
  if (!row) throw new Error(`could not upsert investor "${name}"`);
  return row.id;
}

/** Union investors onto the deal; a lead claim from any source wins over participating. */
async function linkInvestors(id: string, c: DealCandidate): Promise<void> {
  const db = getDb();
  for (const [role, names] of [
    ["lead", c.investors.lead],
    ["participating", c.investors.participating],
    ["existing", c.investors.existing],
  ] as const) {
    for (const name of names) {
      const investorId = await upsertInvestor(name, c.announcedDate);
      const existingRoles = (
        await db
          .select({ role: dealInvestors.role })
          .from(dealInvestors)
          .where(and(eq(dealInvestors.dealId, id), eq(dealInvestors.investorId, investorId)))
      ).map((r) => r.role);
      if (existingRoles.includes(role)) continue;
      if (role === "participating" && existingRoles.includes("lead")) continue;
      if (role === "lead" && existingRoles.includes("participating")) {
        await db
          .update(dealInvestors)
          .set({ role: "lead", updatedAt: new Date() })
          .where(and(eq(dealInvestors.dealId, id), eq(dealInvestors.investorId, investorId), eq(dealInvestors.role, "participating")));
        continue;
      }
      await db.insert(dealInvestors).values({ dealId: id, investorId, role }).onConflictDoNothing();
    }
  }
}

// ─── Recompute a deal from all its sources ─────────────────────────────────

export async function recomputeDeal(id: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      rawArticleId: dealSources.rawArticleId,
      publication: dealSources.publication,
      publishedAt: dealSources.publishedAt,
      stage: dealSources.reportedStage,
      amountUsd: dealSources.reportedAmountUsd,
      amountRaw: dealSources.reportedAmountRaw,
      amountConfidence: dealSources.reportedAmountConfidence,
      investorsLead: dealSources.reportedInvestorsLead,
    })
    .from(dealSources)
    .where(eq(dealSources.dealId, id))
    .orderBy(asc(dealSources.rawArticleId));
  if (rows.length === 0) return;
  const reports: SourceReport[] = rows.map((r) => ({
    publication: r.publication,
    publishedAt: r.publishedAt,
    stage: r.stage,
    amountUsd: r.amountUsd === null ? null : Number(r.amountUsd),
    amountRaw: r.amountRaw,
    amountConfidence: r.amountConfidence,
    investorsLead: r.investorsLead ?? [],
  }));
  const m = mergeReports(reports);

  await db
    .update(deals)
    .set({
      roundStage: m.roundStage,
      amountUsd: m.amountUsd === null ? null : String(m.amountUsd),
      // INR follows the merged USD figure at the deal's recorded FX rate.
      amountInr: m.amountUsd === null ? null : sql`round(${String(m.amountUsd)}::numeric * ${deals.fxRateUsed})`,
      amountRaw: m.amountRaw,
      amountConfidence: m.amountConfidence,
      corroborationCount: m.corroborationCount,
      hasDisputedField: m.hasDisputedField,
      disputedFields: m.disputedFields,
      isVerified: m.isVerified,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, id));
  const primary = rows[m.primaryIndex];
  await db
    .update(dealSources)
    .set({ isPrimary: sql`${dealSources.rawArticleId} = ${primary?.rawArticleId ?? -1}` })
    .where(eq(dealSources.dealId, id));
}

// ─── Attach a funding candidate ────────────────────────────────────────────

interface ArticleCtx {
  rawArticleId: number;
  url: string;
  headline: string | null;
  publishedAt: Date | null;
  publication: string;
}

export async function attachDeal(
  c: DealCandidate,
  match: MatchResult | null,
  art: ArticleCtx,
  meta: { extractedRecordId: number; ingestionMode: string; runId: string; backfillSource?: string | null },
  embedding: number[] | null,
): Promise<{ dealId: string; created: boolean }> {
  const db = getDb();
  const companyId = await resolveCompany(c, c.announcedDate, embedding);
  let id = match?.dealId;
  let created = false;

  if (!id) {
    id = makeDealId(c.normalizedName, c.roundStage, c.isoWeek);
    const inserted = await db
      .insert(deals)
      .values({
        id,
        companyId,
        roundStage: c.roundStage,
        stageRaw: c.stageRaw,
        amountRaw: c.amountRaw,
        amountUsd: c.amount ? String(c.amount.amountUsd) : null,
        amountInr: c.amount ? String(c.amount.amountInr) : null,
        amountConfidence: c.amountConfidence,
        fxRateUsed: c.amount ? String(c.amount.fxRateUsed) : null,
        fxRateDate: c.amount?.fxRateDate ?? null,
        announcedDate: c.announcedDate,
        isoWeek: c.isoWeek,
        sectorPrimary: c.sectorPrimary,
        sectorSecondary: c.sectorSecondary,
        subSector: c.subSector,
        hqCity: c.hqCity,
        valuationUsd: c.valuationUsd === null ? null : String(c.valuationUsd),
        priorRoundStage: c.priorRoundStage,
        priorRoundDate: c.priorRoundDate,
        extractionConfidence: String(c.extractionConfidence),
        ingestionMode: meta.ingestionMode,
        backfillSource: meta.backfillSource ?? null,
        runId: meta.runId,
      })
      .onConflictDoNothing()
      .returning({ id: deals.id });
    created = inserted.length > 0;
  } else {
    // Fill blanks on the existing deal from the new source.
    await db
      .update(deals)
      .set({
        subSector: sql`coalesce(${deals.subSector}, ${c.subSector})`,
        hqCity: sql`coalesce(${deals.hqCity}, ${c.hqCity})`,
        valuationUsd: sql`coalesce(${deals.valuationUsd}, ${c.valuationUsd === null ? null : String(c.valuationUsd)})`,
        priorRoundStage: sql`coalesce(${deals.priorRoundStage}, ${c.priorRoundStage})`,
        priorRoundDate: sql`coalesce(${deals.priorRoundDate}, ${c.priorRoundDate}::date)`,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, id));
  }

  await db
    .insert(dealSources)
    .values({
      dealId: id,
      rawArticleId: art.rawArticleId,
      publication: art.publication,
      url: art.url,
      headline: art.headline,
      publishedAt: art.publishedAt,
      extractedRecordId: meta.extractedRecordId,
      reportedStage: c.roundStage,
      reportedAmountUsd: c.amount ? String(c.amount.amountUsd) : null,
      reportedAmountRaw: c.amountRaw,
      reportedAmountConfidence: c.amountConfidence,
      reportedInvestorsLead: c.investors.lead,
      extractionConfidence: String(c.extractionConfidence),
    })
    .onConflictDoNothing();

  await linkInvestors(id, c);
  await recomputeDeal(id);
  return { dealId: id, created };
}

// ─── Events ────────────────────────────────────────────────────────────────

export async function attachEvent(
  e: EventCandidate,
  art: ArticleCtx,
  meta: { ingestionMode: string; runId: string },
): Promise<{ eventId: string; created: boolean }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.eventType, e.eventType),
        eq(events.subjectKey, e.subjectKey),
        sql`${events.eventDate} BETWEEN (${e.eventDate}::date - ${W.windowDays}::int) AND (${e.eventDate}::date + ${W.windowDays}::int)`,
      ),
    )
    .orderBy(sql`abs(${events.eventDate} - ${e.eventDate}::date)`)
    .limit(1);

  let id = existing?.id;
  let created = false;
  if (!id) {
    const companyId = e.companyName
      ? await resolveCompany({ companyName: e.companyName, normalizedName: normalizeCompanyName(e.companyName), sectorPrimary: e.sectorPrimary, hqCity: e.hqCity }, e.eventDate)
      : null;
    const counterpartyId = e.counterpartyName
      ? await resolveCompany({ companyName: e.counterpartyName, normalizedName: normalizeCompanyName(e.counterpartyName) }, e.eventDate)
      : null;
    id = makeEventId(e.eventType, e.subjectKey, e.isoWeek);
    const inserted = await db
      .insert(events)
      .values({
        id,
        eventType: e.eventType,
        subjectKey: e.subjectKey,
        companyId,
        counterpartyCompanyId: counterpartyId,
        headline: e.headline,
        detail: null,
        amountUsd: e.amountUsd === null ? null : String(e.amountUsd),
        eventDate: e.eventDate,
        isoWeek: e.isoWeek,
        sectorPrimary: e.sectorPrimary,
        personName: e.personName,
        personRole: e.personRole,
        moveType: e.moveType,
        fromCompany: e.fromCompany,
        toCompany: e.toCompany,
        fundName: e.fundName,
        fundSizeUsd: e.fundSizeUsd === null ? null : String(e.fundSizeUsd),
        fundVintage: e.fundVintage,
        statedFocus: e.statedFocus,
        ingestionMode: meta.ingestionMode,
        runId: meta.runId,
      })
      .onConflictDoNothing()
      .returning({ id: events.id });
    created = inserted.length > 0;
  }

  await db
    .insert(eventSources)
    .values({ eventId: id, rawArticleId: art.rawArticleId, publication: art.publication, url: art.url })
    .onConflictDoNothing();
  const [agg] = await db
    .select({ n: sql<number>`count(DISTINCT lower(${eventSources.publication}))::int`, first: sql<number>`min(${eventSources.rawArticleId})` })
    .from(eventSources)
    .where(eq(eventSources.eventId, id));
  await db.update(events).set({ corroborationCount: agg?.n ?? 1, updatedAt: new Date() }).where(eq(events.id, id));
  await db
    .update(eventSources)
    .set({ isPrimary: sql`${eventSources.rawArticleId} = ${agg?.first ?? -1}` })
    .where(eq(eventSources.eventId, id));
  return { eventId: id, created };
}

// ─── Stage runner ──────────────────────────────────────────────────────────

export interface DedupeFunnel {
  candidates: number;
  newDeals: number;
  mergedDeals: number;
  newEvents: number;
  mergedEvents: number;
  rejected: number;
  byLayer: Record<string, number>;
}

async function reject(id: number, reason: string): Promise<void> {
  await getDb()
    .update(extractedRecords)
    .set({ status: "rejected", rejectReason: reason.slice(0, 500), updatedAt: new Date() })
    .where(eq(extractedRecords.id, id));
}

export async function runDedupe(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const log: Logger = runLogger(opts.runId, "dedupe");
  const stage = await startStage(opts.runId, "dedupe");
  const db = getDb();
  const today = toIsoDate(new Date());
  const funnel: DedupeFunnel = { candidates: 0, newDeals: 0, mergedDeals: 0, newEvents: 0, mergedEvents: 0, rejected: 0, byLayer: {} };
  const canEmbed = embeddingsAvailable();
  let stopReason: string | null = null;

  const pending = await db
    .select({
      id: extractedRecords.id,
      kind: extractedRecords.kind,
      payload: extractedRecords.payload,
      ingestionMode: extractedRecords.ingestionMode,
      rawArticleId: rawArticles.id,
      url: rawArticles.url,
      headline: rawArticles.headline,
      publishedAt: rawArticles.publishedAt,
      publication: sources.name,
    })
    .from(extractedRecords)
    .innerJoin(rawArticles, eq(rawArticles.id, extractedRecords.rawArticleId))
    .leftJoin(sources, eq(sources.id, rawArticles.sourceId))
    .where(eq(extractedRecords.status, "pending"))
    .orderBy(asc(extractedRecords.id))
    .limit(W.recordsPerInvocation);

  for (const rec of pending) {
    if (Date.now() > opts.deadline) break;
    funnel.candidates++;
    const art: ArticleCtx = {
      rawArticleId: rec.rawArticleId,
      url: rec.url,
      headline: rec.headline,
      publishedAt: rec.publishedAt,
      publication: rec.publication ?? new URL(rec.url).hostname,
    };
    try {
      if (rec.kind === "funding") {
        const parsed = extractedDealSchema.safeParse(rec.payload);
        if (!parsed.success) {
          await reject(rec.id, "payload failed schema re-validation");
          funnel.rejected++;
          continue;
        }
        const date = resolveAnnouncedDate(parsed.data.announced_date, rec.publishedAt, new Date());
        if (!date) {
          await reject(rec.id, "no usable announced or published date");
          funnel.rejected++;
          continue;
        }
        const built = buildDealCandidate(parsed.data, { announcedDate: date, fx: await fxForDate(date), today });
        if (!built.ok) {
          await reject(rec.id, built.reason);
          funnel.rejected++;
          continue;
        }
        const c = built.value;
        let embedding: number[] | null = null;
        if (canEmbed && c.description) {
          embedding = (await embedTexts([companyEmbeddingText(c)], { dimensions: EMBEDDING_DIMENSIONS, counters: stage.counters }))[0] ?? null;
        }
        const match = await findMatch(c, embedding, stage.counters);
        const { dealId, created } = await attachDeal(
          c,
          match,
          art,
          { extractedRecordId: rec.id, ingestionMode: rec.ingestionMode, runId: opts.runId, backfillSource: rec.ingestionMode === "backfill" ? "weekly_roundup" : null },
          embedding,
        );
        if (created) funnel.newDeals++;
        else funnel.mergedDeals++;
        const layerKey = match ? `layer_${match.layer}` : created ? "new" : "same_id";
        funnel.byLayer[layerKey] = (funnel.byLayer[layerKey] ?? 0) + 1;
        if (!c.stageMapped && c.stageRaw) log.info("unmapped stage phrasing", { stage_raw: c.stageRaw, deal_id: dealId });
        await db.update(extractedRecords).set({ status: "merged", dealId, updatedAt: new Date() }).where(eq(extractedRecords.id, rec.id));
      } else {
        const parsed = extractedEventSchema.safeParse(rec.payload);
        if (!parsed.success) {
          await reject(rec.id, "payload failed schema re-validation");
          funnel.rejected++;
          continue;
        }
        const date = resolveAnnouncedDate(parsed.data.event_date, rec.publishedAt, new Date());
        if (!date) {
          await reject(rec.id, "no usable event or published date");
          funnel.rejected++;
          continue;
        }
        const built = buildEventCandidate(parsed.data, { eventDate: date, fx: await fxForDate(date) });
        if (!built.ok) {
          await reject(rec.id, built.reason);
          funnel.rejected++;
          continue;
        }
        const { eventId, created } = await attachEvent(built.value, art, { ingestionMode: rec.ingestionMode, runId: opts.runId });
        if (created) funnel.newEvents++;
        else funnel.mergedEvents++;
        await db.update(extractedRecords).set({ status: "merged", eventId, updatedAt: new Date() }).where(eq(extractedRecords.id, rec.id));
      }
    } catch (err) {
      if (err instanceof GeminiUnavailableError) {
        stopReason = err.message;
        funnel.candidates--;
        break;
      }
      // Leave the record pending for replay but record the failure.
      log.error("dedupe failed for record", { record_id: rec.id, error: err instanceof Error ? err : String(err) });
      await reject(rec.id, `error: ${err instanceof Error ? err.message : String(err)}`);
      funnel.rejected++;
    }
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(extractedRecords).where(eq(extractedRecords.status, "pending"));
  const next_cursor = stopReason === null && (left?.n ?? 0) > 0 && funnel.candidates > 0 ? "more" : null;
  stage.counters.itemsIn = funnel.candidates;
  stage.counters.itemsOut = funnel.newDeals + funnel.newEvents;
  await stage.finish(stopReason ? "partial" : "ok", { funnel, stopReason, embeddings: canEmbed });
  log.info("dedupe chunk done", { ...funnel });
  return { processed: funnel.candidates, next_cursor, detail: { funnel } };
}
