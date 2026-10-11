import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { mandateConfigSchema, type MandateConfig } from "@/config/profile";
import { PIPELINE } from "@/config/pipeline";
import { getDb } from "@/db/client";
import {
  adjacencyEdges,
  companies,
  dealInvestors,
  deals,
  detectorRuns,
  EMBEDDING_DIMENSIONS,
  investors,
  patterns,
  portfolio,
  profiles,
  relevanceScores,
  sectorFit,
  watchlist,
} from "@/db/schema";
import { latestCompletedWeek } from "@/db/queries/detection";
import { embedTexts, geminiConfigured, GeminiUnavailableError, generateStructured } from "@/lib/gemini";
import { runLogger } from "@/lib/logger";
import { startStage, type StageCounters } from "@/lib/run-log";
import type { StageResult } from "@/pipeline/ingest/collect";
import { sha256 } from "@/pipeline/ingest/url";
import { normalizeCompanyName, normalizeInvestorKey, toIsoDate } from "@/pipeline/normalize";
import { scoreDeal, type AdjacencyRelationship, type DealFacts, type Scorecard } from "@/pipeline/rubric";

/**
 * Stage F — per-profile relevance scoring and portfolio adjacency (PRD §11,
 * §13). Gemini does two bounded jobs here: sector fit (cached per sector ×
 * sub-sector × mandate) and adjacency adjudication (only for pairs the vector
 * shortlist admits). Everything else is deterministic.
 */

const S = PIPELINE.score;

export interface ProfileRow {
  id: string;
  config: MandateConfig;
  lastDigestSentAt: Date | null;
}

export async function loadProfiles(): Promise<ProfileRow[]> {
  const rows = await getDb()
    .select({ id: profiles.id, config: profiles.config, lastDigestSentAt: profiles.lastDigestSentAt })
    .from(profiles)
    .orderBy(asc(profiles.id));
  return rows.map((r) => ({ id: r.id, config: mandateConfigSchema.parse(r.config), lastDigestSentAt: r.lastDigestSentAt }));
}

/** Digest window: last_digest_sent_at → now, else the last 7 days (CLAUDE.md §7.1). */
export function digestWindow(lastSent: Date | null, now: Date): { start: string; end: string } {
  const start = lastSent ?? new Date(now.getTime() - 7 * 86_400_000);
  return { start: toIsoDate(start), end: toIsoDate(now) };
}

export function mandateHash(cfg: MandateConfig): string {
  return sha256(JSON.stringify({ core: cfg.sectors_core, watch: cfg.sectors_watch })).slice(0, 16);
}

const subKey = (s: string | null) => (s ?? "").trim().toLowerCase();

// ─── Portfolio embeddings ──────────────────────────────────────────────────

export function portfolioEmbeddingText(p: { description: string; adjacencyKeywords: string[] }): string {
  // PRD §13.1: description + adjacency_keywords.join(', ')
  return `${p.description} ${p.adjacencyKeywords.join(", ")}`;
}

async function embedPortfolio(counters: StageCounters): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: portfolio.id, description: portfolio.description, adjacencyKeywords: portfolio.adjacencyKeywords })
    .from(portfolio)
    .where(and(isNull(portfolio.embedding), eq(portfolio.isActive, true)));
  if (rows.length === 0) return 0;
  const vectors = await embedTexts(rows.map(portfolioEmbeddingText), { dimensions: EMBEDDING_DIMENSIONS, counters });
  for (let i = 0; i < rows.length; i++) {
    const v = vectors[i];
    const r = rows[i];
    if (v && r) await db.update(portfolio).set({ embedding: v, updatedAt: new Date() }).where(eq(portfolio.id, r.id));
  }
  return rows.length;
}

// ─── Sector fit (batched, cached) ──────────────────────────────────────────

const sectorFitResponse = z.object({
  results: z.array(
    z.object({
      i: z.number().int(),
      fit: z.number().min(0).max(1),
      label: z.enum(["primary", "adjacent", "watch", "unrelated"]),
      reason: z.string().max(200),
    }),
  ),
});

async function ensureSectorFits(p: ProfileRow, pairs: { sector: string; sub: string | null }[], counters: StageCounters, deadline: number): Promise<boolean> {
  const db = getDb();
  const hash = mandateHash(p.config);
  const have = await db
    .select({ sector: sectorFit.sector, key: sectorFit.subSectorKey })
    .from(sectorFit)
    .where(and(eq(sectorFit.profileId, p.id), eq(sectorFit.mandateHash, hash)));
  const known = new Set(have.map((h) => `${h.sector}|${h.key}`));
  const seen = new Set<string>();
  const missing = pairs.filter((x) => {
    const k = `${x.sector}|${subKey(x.sub)}`;
    if (known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const core = p.config.sectors_core.map((c) => `- ${c.name}: ${c.sub.join(", ")}`).join("\n");
  for (let i = 0; i < missing.length; i += S.sectorFitBatch) {
    if (Date.now() > deadline) return false;
    const batch = missing.slice(i, i + S.sectorFitBatch);
    const { data } = await generateStructured({
      task: "classify",
      prompt: { name: "sector-fit", version: 1 },
      vars: {
        core,
        watch: p.config.sectors_watch.join(", ") || "none",
        items: JSON.stringify(batch.map((b, j) => ({ i: j, sector: b.sector, sub_sector: b.sub })), null, 1),
      },
      schema: sectorFitResponse,
      temperature: 0.1,
      counters,
    });
    const byI = new Map(data.results.map((r) => [r.i, r]));
    const rows = batch.flatMap((b, j) => {
      const r = byI.get(j);
      return r ? [{ profileId: p.id, sector: b.sector, subSectorKey: subKey(b.sub), mandateHash: hash, fit: String(r.fit), reason: r.reason }] : [];
    });
    if (rows.length) await db.insert(sectorFit).values(rows).onConflictDoNothing();
  }
  return true;
}

// ─── Adjacency: vector shortlist → Gemini adjudication ─────────────────────

const adjacencyResponse = z.object({
  is_related: z.boolean(),
  relationship: z.enum(["competitor", "same_layer", "supplier", "customer", "complement", "unrelated"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
});

export interface AdjacencyStats {
  shortlisted: number;
  adjudicated: number;
  edges: number;
}

async function detectAdjacency(p: ProfileRow, counters: StageCounters, deadline: number): Promise<{ done: boolean; stats: AdjacencyStats }> {
  const db = getDb();
  const stats: AdjacencyStats = { shortlisted: 0, adjudicated: 0, edges: 0 };
  const held = await db
    .select({ id: portfolio.id, name: portfolio.name, description: portfolio.description, keywords: portfolio.adjacencyKeywords })
    .from(portfolio)
    .where(and(eq(portfolio.profileId, p.id), eq(portfolio.isActive, true), isNotNull(portfolio.embedding)));

  for (const h of held) {
    // Phase 1 — cheap: cosine shortlist in SQL. A tracked company's own raise
    // is "portfolio_mentioned" (an alert), not adjacency, so it is excluded.
    const sim = sql<number>`1 - (${companies.embedding} <=> (SELECT ${portfolio.embedding} FROM ${portfolio} WHERE ${portfolio.id} = ${h.id}))`;
    const shortlist = await db
      .select({
        dealId: deals.id,
        company: companies.canonicalName,
        description: companies.description,
        sector: deals.sectorPrimary,
        subSector: deals.subSector,
        sim,
      })
      .from(deals)
      .innerJoin(companies, eq(companies.id, deals.companyId))
      .where(
        and(
          isNotNull(companies.embedding),
          sql`${sim} >= ${S.adjacencyMinSimilarity}`,
          sql`${companies.normalizedName} <> ${normalizeCompanyName(h.name)}`,
        ),
      )
      .orderBy(sql`${sim} DESC`)
      .limit(S.adjacencyMaxPerPortfolio);
    stats.shortlisted += shortlist.length;

    // Phase 2 — precise: one adjudication per shortlisted pair (cached by content).
    for (const c of shortlist) {
      if (Date.now() > deadline) return { done: false, stats };
      const { data } = await generateStructured({
        task: "adjudicate",
        prompt: { name: "adjacency", version: 1 },
        vars: {
          portfolio: JSON.stringify({ name: h.name, description: h.description, keywords: h.keywords }, null, 1),
          deal: JSON.stringify({ name: c.company, description: c.description, sector: c.sector, sub_sector: c.subSector }, null, 1),
        },
        schema: adjacencyResponse,
        temperature: 0.1,
        counters,
      });
      stats.adjudicated++;
      if (data.is_related && data.relationship !== "unrelated" && data.confidence >= S.adjacencyMinConfidence) {
        await db
          .insert(adjacencyEdges)
          .values({
            profileId: p.id,
            portfolioId: h.id,
            dealId: c.dealId,
            relationship: data.relationship,
            confidence: String(data.confidence),
            rationale: data.rationale,
            vectorSimilarity: String(Number(c.sim).toFixed(4)),
          })
          .onConflictDoUpdate({
            target: [adjacencyEdges.portfolioId, adjacencyEdges.dealId],
            set: {
              relationship: sql`excluded.relationship`,
              confidence: sql`excluded.confidence`,
              rationale: sql`excluded.rationale`,
              vectorSimilarity: sql`excluded.vector_similarity`,
              updatedAt: new Date(),
            },
          });
        stats.edges++;
      }
    }
  }
  return { done: true, stats };
}

// ─── Deterministic inputs: percentiles, watchlist, investors ───────────────

interface DealRow {
  id: string;
  companyName: string;
  normalizedName: string;
  aliases: string[] | null;
  description: string | null;
  sector: string;
  subSector: string | null;
  stage: string;
  priorRoundStage: string | null;
  amountUsd: string | null;
  city: string | null;
  announcedDate: string;
  corroborationCount: number;
  isVerified: boolean;
}

/** Mid-rank percentile of `v` within `values` (0..1). */
export function percentileOf(v: number, values: number[]): number {
  if (values.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const x of values) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return (below + 0.5 * equal) / values.length;
}

export function chequePercentiles(rows: { id: string; stage: string; sector: string; amount: number | null }[], minBucket: number) {
  const byBucket = new Map<string, number[]>();
  const byStage = new Map<string, number[]>();
  for (const r of rows) {
    if (r.amount === null) continue;
    const bk = `${r.stage} × ${r.sector}`;
    byBucket.set(bk, [...(byBucket.get(bk) ?? []), r.amount]);
    byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r.amount]);
  }
  const out = new Map<string, { value: number; bucket: string; n: number }>();
  for (const r of rows) {
    if (r.amount === null) continue;
    const bk = `${r.stage} × ${r.sector}`;
    const bucket = byBucket.get(bk) ?? [];
    if (bucket.length >= minBucket) out.set(r.id, { value: percentileOf(r.amount, bucket), bucket: bk, n: bucket.length });
    else {
      const st = byStage.get(r.stage) ?? [];
      if (st.length >= minBucket) out.set(r.id, { value: percentileOf(r.amount, st), bucket: `${r.stage} (all sectors)`, n: st.length });
    }
  }
  return out;
}

// ─── Stage runner ──────────────────────────────────────────────────────────

export async function scoreProfile(p: ProfileRow, data: Awaited<ReturnType<typeof loadScoringData>>, now: Date): Promise<{ scored: number; serendipity: number }> {
  const db = getDb();
  const window = digestWindow(p.lastDigestSentAt, now);
  const hash = mandateHash(p.config);

  const fits = new Map(
    (
      await db
        .select({ sector: sectorFit.sector, key: sectorFit.subSectorKey, fit: sectorFit.fit, reason: sectorFit.reason })
        .from(sectorFit)
        .where(and(eq(sectorFit.profileId, p.id), eq(sectorFit.mandateHash, hash)))
    ).map((f) => [`${f.sector}|${f.key}`, { fit: Number(f.fit), reason: f.reason }]),
  );
  const wl = await db.select({ type: watchlist.watchType, value: watchlist.value, norm: watchlist.normalizedValue, aliases: watchlist.aliases }).from(watchlist).where(eq(watchlist.profileId, p.id));
  const watchedInvestors = new Map(wl.filter((w) => w.type === "investor").map((w) => [w.norm, w.value]));
  const watchedCompanies = new Map<string, string>();
  for (const w of wl.filter((x) => x.type === "company")) {
    watchedCompanies.set(w.norm, w.value);
    for (const a of w.aliases ?? []) watchedCompanies.set(normalizeCompanyName(a), w.value);
  }
  const edges = await db
    .select({ dealId: adjacencyEdges.dealId, relationship: adjacencyEdges.relationship, confidence: adjacencyEdges.confidence, rationale: adjacencyEdges.rationale, portfolioName: portfolio.name })
    .from(adjacencyEdges)
    .innerJoin(portfolio, eq(portfolio.id, adjacencyEdges.portfolioId))
    .where(and(eq(adjacencyEdges.profileId, p.id), eq(portfolio.isActive, true)));
  const rank: Record<string, number> = { competitor: 3, same_layer: 2, supplier: 1, customer: 1, complement: 1 };
  const bestEdge = new Map<string, (typeof edges)[number]>();
  for (const e of edges) {
    const cur = bestEdge.get(e.dealId);
    if (!cur || (rank[e.relationship] ?? 0) > (rank[cur.relationship] ?? 0)) bestEdge.set(e.dealId, e);
  }

  // +10 override: a watchlist investor's first move into a core sector, only as
  // found by the investor-rotation detector after all four guards (PRD §11.2).
  const week = latestCompletedWeek(now);
  const [rotationRun] = await db
    .select({ runId: detectorRuns.runId })
    .from(detectorRuns)
    .where(and(eq(detectorRuns.profileId, p.id), eq(detectorRuns.isoWeek, week), eq(detectorRuns.detectorKey, "investor_rotation")))
    .limit(1);
  const rotations = rotationRun
    ? await db
        .select({ statBasis: patterns.statBasis, evidence: patterns.evidenceDealIds })
        .from(patterns)
        .where(and(eq(patterns.profileId, p.id), eq(patterns.isoWeek, week), eq(patterns.detectorKey, "investor_rotation"), eq(patterns.runId, rotationRun.runId)))
    : [];
  const coreSectors = new Set(p.config.sectors_core.map((c) => c.name));
  const firstMoveByDeal = new Map<string, { investor: string; sector: string }>();
  for (const r of rotations) {
    const sb = r.statBasis as { investor?: string; sector?: string };
    if (!sb.investor || !sb.sector || !coreSectors.has(sb.sector)) continue;
    const display = watchedInvestors.get(normalizeInvestorKey(sb.investor));
    if (!display) continue;
    for (const id of r.evidence ?? []) firstMoveByDeal.set(id, { investor: display, sector: sb.sector });
  }

  const cards: { id: string; card: Scorecard; inWindow: boolean }[] = [];
  for (const d of data.deals) {
    const facts: DealFacts = {
      companyName: d.companyName,
      description: d.description,
      sector: d.sector,
      subSector: d.subSector,
      stage: d.stage,
      priorRoundStage: d.priorRoundStage,
      amountUsd: d.amountUsd === null ? null : Number(d.amountUsd),
      city: d.city,
      announcedDate: d.announcedDate,
      corroborationCount: d.corroborationCount,
      isVerified: d.isVerified,
      investors: data.investorsByDeal.get(d.id) ?? [],
    };
    const fit = fits.get(`${d.sector}|${subKey(d.subSector)}`) ?? { fit: 0, reason: "Sector fit not yet evaluated" };
    const names = [d.normalizedName, ...(d.aliases ?? []).map(normalizeCompanyName)];
    const watched = names.map((n) => watchedCompanies.get(n)).find(Boolean) ?? null;
    const edge = bestEdge.get(d.id);
    const card = scoreDeal(facts, {
      config: p.config,
      sectorFit: fit,
      watchedInvestors,
      watchlistCompany: watched,
      adjacency: edge ? { relationship: edge.relationship as AdjacencyRelationship, portfolioName: edge.portfolioName, rationale: edge.rationale } : null,
      investorFirstMove: firstMoveByDeal.get(d.id) ?? null,
      chequePercentile: data.cheque.get(d.id) ?? null,
      investorTier: data.investorTierByDeal.get(d.id) ?? null,
      window,
      normalizeInvestor: normalizeInvestorKey,
    });
    cards.push({ id: d.id, card, inWindow: d.announcedDate >= window.start && d.announcedDate <= window.end });
  }

  // Serendipity (PRD §11.4): top-decile significance in the window, low mandate fit, not excluded.
  const chosen = new Set<string>();
  if (p.config.serendipity.enabled) {
    const pool = cards.filter((c) => c.inWindow && !c.card.excluded);
    const sig = pool.map((c) => c.card.significance_score).sort((a, b) => a - b);
    const cutoff = sig.length ? (sig[Math.floor(sig.length * 0.9)] ?? sig[sig.length - 1] ?? 0) : Infinity;
    pool
      .filter((c) => c.card.significance_score >= cutoff && c.card.mandate_score < p.config.serendipity.max_mandate_score)
      .sort((a, b) => b.card.significance_score - a.card.significance_score)
      .slice(0, p.config.serendipity.count)
      .forEach((c) => chosen.add(c.id));
  }

  for (let i = 0; i < cards.length; i += 100) {
    const batch = cards.slice(i, i + 100);
    await db
      .insert(relevanceScores)
      .values(
        batch.map((c) => ({
          dealId: c.id,
          profileId: p.id,
          score: String(c.card.total),
          tier: c.card.tier,
          breakdown: c.card as unknown as object,
          reason: c.card.reason,
          isSerendipity: chosen.has(c.id),
          computedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [relevanceScores.dealId, relevanceScores.profileId],
        set: {
          score: sql`excluded.score`,
          tier: sql`excluded.tier`,
          breakdown: sql`excluded.breakdown`,
          reason: sql`excluded.reason`,
          isSerendipity: sql`excluded.is_serendipity`,
          computedAt: sql`excluded.computed_at`,
          updatedAt: new Date(),
        },
      });
  }
  return { scored: cards.length, serendipity: chosen.size };
}

export async function loadScoringData() {
  const db = getDb();
  const rows: DealRow[] = await db
    .select({
      id: deals.id,
      companyName: companies.canonicalName,
      normalizedName: companies.normalizedName,
      aliases: companies.aliases,
      description: companies.description,
      sector: deals.sectorPrimary,
      subSector: deals.subSector,
      stage: deals.roundStage,
      priorRoundStage: deals.priorRoundStage,
      amountUsd: deals.amountUsd,
      city: deals.hqCity,
      announcedDate: deals.announcedDate,
      corroborationCount: deals.corroborationCount,
      isVerified: deals.isVerified,
    })
    .from(deals)
    .innerJoin(companies, eq(companies.id, deals.companyId));
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await db
        .select({ dealId: dealInvestors.dealId, role: dealInvestors.role, name: investors.canonicalName, dealCount: investors.dealCount })
        .from(dealInvestors)
        .innerJoin(investors, eq(investors.id, dealInvestors.investorId))
        .where(inArray(dealInvestors.dealId, ids))
    : [];
  const counts = (await db.select({ n: investors.dealCount }).from(investors).where(sql`${investors.dealCount} > 0`)).map((c) => c.n);
  const investorsByDeal = new Map<string, DealFacts["investors"]>();
  const investorTierByDeal = new Map<string, { value: number; investor: string }>();
  for (const l of links) {
    investorsByDeal.set(l.dealId, [...(investorsByDeal.get(l.dealId) ?? []), { name: l.name, role: l.role as "lead" | "participating" | "existing" }]);
    const t = percentileOf(l.dealCount, counts);
    const cur = investorTierByDeal.get(l.dealId);
    if (!cur || t > cur.value) investorTierByDeal.set(l.dealId, { value: t, investor: l.name });
  }
  const cheque = chequePercentiles(
    rows.map((r) => ({ id: r.id, stage: r.stage, sector: r.sector, amount: r.amountUsd === null ? null : Number(r.amountUsd) })),
    S.chequeBucketMin,
  );
  return { deals: rows, investorsByDeal, investorTierByDeal, cheque };
}

export async function runScore(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const log = runLogger(opts.runId, "score");
  const stage = await startStage(opts.runId, "score");
  if (!geminiConfigured()) {
    await stage.finish("partial", { stopReason: "Gemini not configured" });
    return { processed: 0, next_cursor: null };
  }
  const now = new Date();
  const detail: Record<string, unknown> = {};
  try {
    detail.portfolioEmbedded = await embedPortfolio(stage.counters);
    const profilesList = await loadProfiles();
    const data = await loadScoringData();
    const pairs = data.deals.map((d) => ({ sector: d.sector, sub: d.subSector }));
    let complete = true;
    for (const p of profilesList) {
      const fitsDone = await ensureSectorFits(p, pairs, stage.counters, opts.deadline);
      const adj = fitsDone ? await detectAdjacency(p, stage.counters, opts.deadline) : { done: false, stats: null };
      detail[`adjacency:${p.id}`] = adj.stats;
      if (!fitsDone || !adj.done) {
        complete = false;
        break; // continue next invocation; partial scores are never written
      }
      detail[`scores:${p.id}`] = await scoreProfile(p, data, now);
    }
    stage.counters.itemsIn = data.deals.length;
    stage.counters.itemsOut = complete ? data.deals.length * profilesList.length : 0;
    await stage.finish(complete ? "ok" : "partial", detail);
    log.info("score chunk done", { complete, ...detail });
    return { processed: data.deals.length, next_cursor: complete ? null : "more" };
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      await stage.finish("partial", { ...detail, stopReason: err.message });
      return { processed: 0, next_cursor: null };
    }
    await stage.finish("error", detail, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
