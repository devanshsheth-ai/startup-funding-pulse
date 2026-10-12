import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { MandateConfig } from "@/config/profile";
import { getDb } from "@/db/client";
import { getAggregates, type Aggregates } from "@/db/queries/aggregates";
import { latestCompletedWeek } from "@/db/queries/detection";
import {
  adjacencyEdges,
  companies,
  dealInvestors,
  dealSources,
  deals,
  detectorRuns,
  digestItems,
  digests,
  events,
  eventSources,
  investors,
  patterns,
  portfolio,
  relevanceScores,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { SIMULATED_PORTFOLIO_FOOTER } from "@/lib/copy";
import { logger } from "@/lib/logger";
import type { StageCounters } from "@/lib/run-log";
import { formatAggregates, formatMandate, narrateDaily, narrateWeekly, type NarrativeItem, type Rejection } from "@/pipeline/narrate";
import { toIsoDate } from "@/pipeline/normalize";
import type { Scorecard, Tier } from "@/pipeline/rubric";
import { loadProfiles, type ProfileRow } from "@/pipeline/score";

/**
 * Stage J (content) — assemble a weekly or daily digest for one profile:
 * sections per PRD §16, narration per Stage I, every number traceable to a
 * deal or event with sources. Pure assembly + one narration call.
 */

export type DigestMode = "weekly" | "daily";

export interface SourceLink {
  publication: string;
  url: string;
  headline: string | null;
  publishedAt: string | null;
  isPrimary: boolean;
}

export interface DealCard {
  id: string;
  company: string;
  description: string | null;
  stage: string;
  amountUsd: number | null;
  amountRaw: string | null;
  sector: string;
  subSector: string | null;
  city: string | null;
  announced: string;
  score: number;
  tier: Tier;
  reason: string;
  isVerified: boolean;
  corroboration: number;
  disputed: string[];
  leads: string[];
  participants: string[];
  sources: SourceLink[];
  breakdown: Scorecard | null;
}

export interface EventItem {
  id: string;
  type: string;
  headline: string;
  date: string;
  amountUsd: number | null;
  fundName: string | null;
  fundSizeUsd: number | null;
  statedFocus: string[];
  mandateOverlap: string[];
  personName: string | null;
  moveType: string | null;
  sources: SourceLink[];
}

export interface DigestContent {
  version: 1;
  mode: DigestMode;
  profile: { id: string; name: string };
  window: { start: string; end: string };
  generatedAt: string;
  isoWeek: string;
  headline: string;
  tldr: string[];
  narrative: NarrativeItem[];
  lpTalkingPoints: string[];
  openQuestions: string[];
  dailyContext: { text: string; evidenceDealIds: string[]; statBasis: string } | null;
  narrationStatus: "ok" | "degraded";
  kpis: {
    deals: number;
    capitalUsd: number;
    medianUsd: number | null;
    prevDeals: number;
    prevCapitalUsd: number;
    temperature: number;
    temperatureComponents: Record<string, { value: number; z: number }>;
    pricedDeals: number;
  };
  watchlistHits: DealCard[];
  adjacency: { portfolio: string; relationship: string; confidence: number; rationale: string; deal: DealCard }[];
  clusters: { portfolio: string; windowDays: number; deals: { company: string; id: string; relationship: string; announced: string; url: string | null }[] }[];
  patterns: { key: string; title: string; statement: string; confidence: string; consecutiveWeeks: number; sampleSize: number; evidence: { id: string; company: string; url: string | null }[] }[];
  suppressedDetectors: { key: string; reason: string }[];
  ranked: { act_now: DealCard[]; high: DealCard[]; relevant: DealCard[]; contextCount: number };
  serendipity: DealCard[];
  sectorHeat: { sector: string; n: number; capitalUsd: number; wowDelta: number; z: number; mandate: boolean }[];
  stages: { stage: string; n: number; capitalUsd: number; medianUsd: number | null; sharePct: number; baselineSharePct: number }[];
  investors: {
    leaderboard: { investor: string; deals: number; leadDeals: number; capitalLedUsd: number; sectors: string[] }[];
    inMandate: { investor: string; deals: number; sectors: string[] }[];
    newEntrants: { statement: string; evidence: { id: string; company: string }[] }[];
    cadenceShifts: { investor: string; deals: number; trailingWeeklyRate: number }[];
    syndicates: { a: string; b: string; together: number; lift: number }[];
    followOnShare: { existing: number; total: number };
  };
  fundCloses: EventItem[];
  exits: EventItem[];
  founders: EventItem[];
  rolling7d: { deals: number; capitalUsd: number; medianUsd: number | null } | null;
  counts: { aggregatesN: number; dealsInWindow: number };
  links: { dashboard: string; methodology: string; settings: string; share: string | null; health: string };
  disclosure: string;
  rejected: Rejection[];
  /** Alerts held back by the daily cap, cooldown or delivery rule, folded into this digest (PRD §15.2). */
  heldAlerts?: { id: number; severity: string; title: string; body: string }[];
}

// ─── Window ────────────────────────────────────────────────────────────────

/** last_digest_sent_at → now; never a fixed span when a send exists (CLAUDE.md §7.1). */
export function windowFor(mode: DigestMode, lastSent: Date | null, now: Date): { start: string; end: string } {
  const fallbackDays = mode === "weekly" ? 7 : 1;
  const start = lastSent ?? new Date(now.getTime() - fallbackDays * 86_400_000);
  return { start: toIsoDate(start), end: toIsoDate(now) };
}

export function appUrl(): string {
  return (getEnv().NEXT_PUBLIC_APP_URL ?? "https://startup-funding-pulse.vercel.app").replace(/\/+$/, "");
}

/** UTM-tag outbound links so clicks are attributable (PRD §17). */
export function withUtm(url: string, mode: DigestMode | "alert"): string {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "fundingpulse");
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", `digest-${mode}`);
    return u.toString();
  } catch {
    return url;
  }
}

// ─── Loaders ───────────────────────────────────────────────────────────────

export async function loadDealCards(profileId: string, dealIds: string[] | null, win: { start: string; end: string } | null): Promise<DealCard[]> {
  const db = getDb();
  const where = dealIds
    ? and(eq(relevanceScores.profileId, profileId), inArray(deals.id, dealIds.length ? dealIds : ["-"]))
    : and(eq(relevanceScores.profileId, profileId), gte(deals.announcedDate, win?.start ?? "1970-01-01"), lte(deals.announcedDate, win?.end ?? "2999-01-01"));
  const rows = await db
    .select({
      id: deals.id,
      company: companies.canonicalName,
      description: companies.description,
      stage: deals.roundStage,
      amountUsd: deals.amountUsd,
      amountRaw: deals.amountRaw,
      sector: deals.sectorPrimary,
      subSector: deals.subSector,
      city: deals.hqCity,
      announced: deals.announcedDate,
      score: relevanceScores.score,
      tier: relevanceScores.tier,
      reason: relevanceScores.reason,
      breakdown: relevanceScores.breakdown,
      isVerified: deals.isVerified,
      corroboration: deals.corroborationCount,
      disputed: deals.disputedFields,
    })
    .from(relevanceScores)
    .innerJoin(deals, eq(deals.id, relevanceScores.dealId))
    .innerJoin(companies, eq(companies.id, deals.companyId))
    .where(where)
    .orderBy(desc(relevanceScores.score), desc(deals.announcedDate));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const srcs = await db
    .select({ dealId: dealSources.dealId, publication: dealSources.publication, url: dealSources.url, headline: dealSources.headline, publishedAt: dealSources.publishedAt, isPrimary: dealSources.isPrimary })
    .from(dealSources)
    .where(inArray(dealSources.dealId, ids));
  const invs = await db
    .select({ dealId: dealInvestors.dealId, role: dealInvestors.role, name: investors.canonicalName })
    .from(dealInvestors)
    .innerJoin(investors, eq(investors.id, dealInvestors.investorId))
    .where(inArray(dealInvestors.dealId, ids));
  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    description: r.description,
    stage: r.stage,
    amountUsd: r.amountUsd === null ? null : Number(r.amountUsd),
    amountRaw: r.amountRaw,
    sector: r.sector,
    subSector: r.subSector,
    city: r.city,
    announced: r.announced,
    score: Number(r.score),
    tier: r.tier as Tier,
    reason: r.reason,
    isVerified: r.isVerified,
    corroboration: r.corroboration,
    disputed: r.disputed ?? [],
    leads: [...new Set(invs.filter((i) => i.dealId === r.id && i.role === "lead").map((i) => i.name))],
    // A lead claim wins: never list the same investor as lead and participant.
    participants: [...new Set(invs.filter((i) => i.dealId === r.id && i.role !== "lead").map((i) => i.name))].filter(
      (n) => !invs.some((i) => i.dealId === r.id && i.role === "lead" && i.name === n),
    ),
    sources: srcs
      .filter((s) => s.dealId === r.id)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0))
      .map((s) => ({ publication: s.publication, url: s.url, headline: s.headline, publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null, isPrimary: s.isPrimary })),
    breakdown: (r.breakdown as Scorecard) ?? null,
  }));
}

function mandateTerms(cfg: MandateConfig): string[] {
  return [...cfg.sectors_core.flatMap((s) => [s.name, ...s.sub]), ...cfg.sectors_watch].map((t) => t.toLowerCase());
}

async function loadEvents(win: { start: string; end: string }, cfg: MandateConfig): Promise<EventItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      type: events.eventType,
      headline: events.headline,
      date: events.eventDate,
      amountUsd: events.amountUsd,
      fundName: events.fundName,
      fundSizeUsd: events.fundSizeUsd,
      statedFocus: events.statedFocus,
      personName: events.personName,
      moveType: events.moveType,
      fromCompany: events.fromCompany,
    })
    .from(events)
    .where(and(gte(events.eventDate, win.start), lte(events.eventDate, win.end)))
    .orderBy(desc(events.eventDate));
  const ids = rows.map((r) => r.id);
  const srcs = ids.length
    ? await db.select({ eventId: eventSources.eventId, publication: eventSources.publication, url: eventSources.url, isPrimary: eventSources.isPrimary }).from(eventSources).where(inArray(eventSources.eventId, ids))
    : [];
  const terms = mandateTerms(cfg);
  return rows.map((r) => {
    const text = [...(r.statedFocus ?? []), r.fundName ?? "", r.headline].join(" ").toLowerCase();
    return {
      id: r.id,
      type: r.type,
      headline: r.headline,
      date: r.date,
      amountUsd: r.amountUsd === null ? null : Number(r.amountUsd),
      fundName: r.fundName,
      fundSizeUsd: r.fundSizeUsd === null ? null : Number(r.fundSizeUsd),
      statedFocus: r.statedFocus ?? [],
      mandateOverlap: r.type === "fund_close" ? [...new Set(terms.filter((t) => t.length > 3 && text.includes(t)))] : [],
      personName: r.personName,
      moveType: r.moveType,
      sources: srcs.filter((s) => s.eventId === r.id).map((s) => ({ publication: s.publication ?? "source", url: s.url, headline: null, publishedAt: null, isPrimary: s.isPrimary })),
    };
  });
}

// ─── Assembly ──────────────────────────────────────────────────────────────

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n / 1e3)}K`);

function compactDeal(d: DealCard): string {
  return `[${d.id}] ${d.company} — ${d.stage}, ${d.amountUsd === null ? "undisclosed" : usd(d.amountUsd)}, ${d.sector}${d.city ? `, ${d.city}` : ""}; score ${d.score} (${d.tier}); ${d.reason}; ${d.corroboration} source(s)`;
}

export async function buildDigest(profile: ProfileRow & { displayName: string }, mode: DigestMode, now: Date, counters?: StageCounters): Promise<DigestContent> {
  const db = getDb();
  const cfg = profile.config;
  const win = windowFor(mode, profile.lastDigestSentAt, now);
  const isoWeek = latestCompletedWeek(now);
  const agg: Aggregates = await getAggregates(win);
  const coreSectors = new Set(cfg.sectors_core.map((s) => s.name));
  const windowDeals = (await loadDealCards(profile.id, null, win)).filter((d) => d.tier !== "archive" || (d.breakdown?.overrides ?? []).length > 0);
  const tracked = await db.select({ id: portfolio.id, name: portfolio.name }).from(portfolio).where(and(eq(portfolio.profileId, profile.id), eq(portfolio.isActive, true)));
  const trackedNames = tracked.map((t) => t.name);

  // Watchlist hits and adjacency alerts (the board-meeting sections).
  const watchlistHits = windowDeals.filter((d) => d.breakdown?.overrides.some((o) => o.key === "watchlist"));
  const edges = await db
    .select({ dealId: adjacencyEdges.dealId, relationship: adjacencyEdges.relationship, confidence: adjacencyEdges.confidence, rationale: adjacencyEdges.rationale, portfolio: portfolio.name, announced: deals.announcedDate })
    .from(adjacencyEdges)
    .innerJoin(portfolio, eq(portfolio.id, adjacencyEdges.portfolioId))
    .innerJoin(deals, eq(deals.id, adjacencyEdges.dealId))
    .where(and(eq(adjacencyEdges.profileId, profile.id), eq(portfolio.isActive, true)));
  const byId = new Map(windowDeals.map((d) => [d.id, d]));
  const adjacency = edges
    .filter((e) => byId.has(e.dealId))
    .map((e) => ({ portfolio: e.portfolio, relationship: e.relationship, confidence: Number(e.confidence), rationale: e.rationale, deal: byId.get(e.dealId) as DealCard }))
    .sort((a, b) => ["competitor", "same_layer"].indexOf(b.relationship) - ["competitor", "same_layer"].indexOf(a.relationship) || b.confidence - a.confidence);

  // Cluster trigger (PRD §13.3): ≥ threshold competitor/same-layer raises per tracked company in the window (D-055).
  const clusterSince = toIsoDate(new Date(now.getTime() - cfg.alerts.cluster_window_days * 86_400_000));
  const close = edges.filter((e) => ["competitor", "same_layer"].includes(e.relationship) && e.announced >= clusterSince);
  const clusterDealIds = [...new Set(close.map((e) => e.dealId))];
  const clusterCards = new Map((await loadDealCards(profile.id, clusterDealIds, null)).map((d) => [d.id, d]));
  const clusters = [...new Set(close.map((e) => e.portfolio))]
    .map((p) => ({
      portfolio: p,
      windowDays: cfg.alerts.cluster_window_days,
      deals: close
        .filter((e) => e.portfolio === p)
        .map((e) => ({ company: clusterCards.get(e.dealId)?.company ?? e.dealId, id: e.dealId, relationship: e.relationship, announced: e.announced, url: clusterCards.get(e.dealId)?.sources[0]?.url ?? null })),
    }))
    .filter((c) => c.deals.length >= cfg.alerts.cluster_threshold);

  // Patterns (weekly only) from the latest detector run for the completed week.
  let patternItems: DigestContent["patterns"] = [];
  let suppressed: DigestContent["suppressedDetectors"] = [];
  if (mode === "weekly") {
    const runs = await db.select({ key: detectorRuns.detectorKey, status: detectorRuns.status, reason: detectorRuns.reason, runId: detectorRuns.runId }).from(detectorRuns).where(and(eq(detectorRuns.profileId, profile.id), eq(detectorRuns.isoWeek, isoWeek)));
    suppressed = runs.filter((r) => r.status === "suppressed").map((r) => ({ key: r.key, reason: r.reason }));
    const runIds = [...new Set(runs.map((r) => r.runId))];
    const pats = runIds.length
      ? await db.select().from(patterns).where(and(eq(patterns.profileId, profile.id), eq(patterns.isoWeek, isoWeek), inArray(patterns.runId, runIds)))
      : [];
    const evIds = [...new Set(pats.flatMap((p) => p.evidenceDealIds ?? []))];
    const evCards = new Map((await loadDealCards(profile.id, evIds, null)).map((d) => [d.id, d]));
    const order = ["sector_silence", "sector_momentum", "investor_rotation", "cheque_inflation", "stage_shift", "capital_concentration", "syndicate_formation", "thesis_clustering", "followon_compression", "geographic_shift", "outlier_deal", "repeat_founder"];
    patternItems = pats
      .sort((a, b) => order.indexOf(a.detectorKey) - order.indexOf(b.detectorKey))
      .map((p) => ({
        key: p.detectorKey,
        title: p.title,
        statement: p.statement,
        confidence: p.confidence,
        consecutiveWeeks: p.consecutiveWeeks,
        sampleSize: p.sampleSize,
        evidence: (p.evidenceDealIds ?? []).slice(0, 6).map((id) => ({ id, company: evCards.get(id)?.company ?? id, url: evCards.get(id)?.sources[0]?.url ?? null })),
      }));
  }

  const ranked = {
    act_now: windowDeals.filter((d) => d.tier === "act_now"),
    high: windowDeals.filter((d) => d.tier === "high"),
    relevant: windowDeals.filter((d) => d.tier === "relevant"),
    contextCount: windowDeals.filter((d) => d.tier === "context").length,
  };
  const serendipityIds = mode === "weekly"
    ? (await db.select({ id: relevanceScores.dealId }).from(relevanceScores).where(and(eq(relevanceScores.profileId, profile.id), eq(relevanceScores.isSerendipity, true)))).map((r) => r.id)
    : [];
  const serendipity = mode === "weekly" ? await loadDealCards(profile.id, serendipityIds, null) : [];

  // Investors.
  const rotation = patternItems.filter((p) => p.key === "investor_rotation");
  const [follow] = (await db.execute(sql`SELECT count(*) FILTER (WHERE di.role = 'existing')::int AS existing, count(*)::int AS total
                                       FROM deal_investors di JOIN deals d ON d.id = di.deal_id
                                       WHERE d.announced_date BETWEEN ${win.start}::date AND ${win.end}::date`)).rows as { existing: number; total: number }[];
  const investorsBlock: DigestContent["investors"] = {
    leaderboard: agg.investors.rows.slice(0, 8).map((i) => ({ investor: i.investor, deals: i.deals, leadDeals: i.lead_deals, capitalLedUsd: i.capital_led, sectors: i.sectors })),
    inMandate: agg.investors.rows.filter((i) => i.sectors.some((s) => coreSectors.has(s))).slice(0, 8).map((i) => ({ investor: i.investor, deals: i.deals, sectors: i.sectors.filter((s) => coreSectors.has(s)) })),
    newEntrants: rotation.map((r) => ({ statement: r.statement, evidence: r.evidence })),
    cadenceShifts: agg.investors.rows.filter((i) => i.deals >= 2 && i.trailing_weekly_rate < 0.5).slice(0, 6).map((i) => ({ investor: i.investor, deals: i.deals, trailingWeeklyRate: i.trailing_weekly_rate })),
    syndicates: agg.coinvestment_pairs.rows.filter((p) => p.together >= 3).slice(0, 5).map((p) => ({ a: p.a, b: p.b, together: p.together, lift: Number(p.lift) })),
    followOnShare: { existing: follow?.existing ?? 0, total: follow?.total ?? 0 },
  };

  const evts = await loadEvents(win, cfg);
  const adjacentCompanies = new Set(adjacency.map((a) => a.deal.company.toLowerCase()));
  const founders = evts.filter(
    (e) => e.type === "people_move" && (e.moveType === "founded" || (e.moveType === "departed" && [...adjacentCompanies, ...trackedNames.map((n) => n.toLowerCase())].some((c) => e.headline.toLowerCase().includes(c)))),
  );

  // Rolling 7-day context (daily).
  let rolling7d: DigestContent["rolling7d"] = null;
  if (mode === "daily") {
    const r = await getAggregates({ start: toIsoDate(new Date(now.getTime() - 7 * 86_400_000)), end: win.end });
    rolling7d = { deals: r.totals.n, capitalUsd: r.totals.capital_usd, medianUsd: r.totals.median_usd };
  }

  // Narration (Stage I): aggregates + patterns + compact summaries, never a bare deal list.
  const fallbackHeadline =
    mode === "weekly"
      ? `${agg.totals.n} deals, ${usd(agg.totals.capital_usd)} raised (${win.start} to ${win.end})`
      : `${agg.totals.n} deals today, ${usd(agg.totals.capital_usd)} raised`;
  const allowedDeals = new Set<string>([...windowDeals.map((d) => d.id), ...patternItems.flatMap((p) => p.evidence.map((e) => e.id)), ...serendipity.map((d) => d.id), ...clusterDealIds]);
  const allowedEvents = new Set<string>(evts.map((e) => e.id));
  const alertsText =
    [
      ...watchlistHits.map((d) => `WATCHLIST ${compactDeal(d)}`),
      ...adjacency.slice(0, 10).map((a) => `ADJACENCY to tracked company ${a.portfolio} (${a.relationship}, confidence ${a.confidence}): ${a.rationale} — ${compactDeal(a.deal)}`),
      ...clusters.map((c) => `CLUSTER: ${c.deals.length} companies adjacent to tracked company ${c.portfolio} raised within ${c.windowDays} days: ${c.deals.map((d) => `[${d.id}] ${d.company}`).join(", ")}`),
    ].join("\n") || "none";
  const topDeals = [...ranked.act_now, ...ranked.high, ...ranked.relevant].slice(0, 15).map(compactDeal).join("\n") || "none";
  const eventsText = evts.slice(0, 20).map((e) => `[${e.id}] ${e.type}: ${e.headline}`).join("\n") || "none";

  let headline = fallbackHeadline;
  let tldr: string[] = [];
  let narrative: NarrativeItem[] = [];
  let lp: string[] = [];
  let oq: string[] = [];
  let dailyContext: DigestContent["dailyContext"] = null;
  let rejected: Rejection[] = [];
  let status: "ok" | "degraded" = "ok";
  if (mode === "weekly") {
    const r = await narrateWeekly(
      {
        mandate: formatMandate(cfg, profile.displayName),
        window: `${win.start} to ${win.end} (ISO week ${isoWeek} patterns)`,
        aggregates: formatAggregates(agg, coreSectors),
        patterns: patternItems.map((p) => `[${p.key}] (${p.confidence}${p.consecutiveWeeks > 1 ? `, week ${p.consecutiveWeeks} in a row` : ""}) ${p.statement} Evidence: ${p.evidence.map((e) => `[${e.id}] ${e.company}`).join(", ")}`).join("\n") || "none fired",
        alerts: alertsText,
        deals: topDeals,
        events: eventsText,
      },
      { deals: allowedDeals, events: allowedEvents },
      trackedNames,
      fallbackHeadline,
      counters,
    );
    if (r.ok && r.value) ({ headline, tldr, narrative, lpTalkingPoints: lp, openQuestions: oq } = r.value);
    else {
      status = "degraded";
      logger.warn("weekly narration degraded; digest ships with statistics only", { profile: profile.id, error: r.error });
    }
    rejected = r.rejected;
  } else {
    const r = await narrateDaily(
      {
        mandate: formatMandate(cfg, profile.displayName),
        today: `${win.start} to ${win.end}: ${agg.totals.n} deals, ${usd(agg.totals.capital_usd)} priced capital, median ${agg.totals.median_usd ? usd(agg.totals.median_usd) : "n/a"}`,
        rolling: rolling7d ? `${rolling7d.deals} deals, ${usd(rolling7d.capitalUsd)} capital, median ${rolling7d.medianUsd ? usd(rolling7d.medianUsd) : "n/a"}` : "n/a",
        deals: topDeals,
        alerts: alertsText,
      },
      allowedDeals,
      trackedNames,
      fallbackHeadline,
      counters,
    );
    if (r.ok && r.value) ({ headline, context: dailyContext } = r.value);
    else {
      status = "degraded";
      logger.warn("daily narration degraded; digest ships with statistics only", { profile: profile.id, error: r.error });
    }
    rejected = r.rejected;
  }

  const held = (await db.execute(sql`
    SELECT id, severity, title, body FROM alerts WHERE profile_id = ${profile.id} AND status = 'batched'
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT 15`)).rows as { id: number; severity: string; title: string; body: string }[];

  const base = appUrl();
  return {
    version: 1,
    mode,
    profile: { id: profile.id, name: profile.displayName },
    window: win,
    generatedAt: now.toISOString(),
    isoWeek,
    headline,
    tldr,
    narrative,
    lpTalkingPoints: mode === "weekly" ? lp : [],
    openQuestions: mode === "weekly" ? oq : [],
    dailyContext,
    narrationStatus: status,
    kpis: {
      deals: agg.totals.n,
      capitalUsd: agg.totals.capital_usd,
      medianUsd: agg.totals.median_usd,
      prevDeals: agg.totals.previous_window.n,
      prevCapitalUsd: agg.totals.previous_window.capital_usd,
      temperature: agg.temperature.value,
      temperatureComponents: Object.fromEntries(Object.entries(agg.temperature.components).map(([k, v]) => [k, { value: v.value, z: v.z }])),
      pricedDeals: agg.totals.priced_n,
    },
    watchlistHits,
    adjacency,
    clusters,
    patterns: patternItems,
    suppressedDetectors: suppressed,
    ranked,
    serendipity,
    sectorHeat: agg.sectors.rows.slice(0, 12).map((s) => ({ sector: s.sector, n: s.n, capitalUsd: s.capital, wowDelta: s.wow_delta, z: s.z, mandate: coreSectors.has(s.sector) })),
    stages: agg.stages.rows.map((s) => ({ stage: s.stage, n: s.n, capitalUsd: s.capital, medianUsd: s.median, sharePct: s.share_pct, baselineSharePct: s.baseline_share_pct })),
    investors: investorsBlock,
    fundCloses: evts.filter((e) => e.type === "fund_close"),
    exits: evts.filter((e) => ["ma", "shutdown", "ipo_filing"].includes(e.type)),
    founders,
    rolling7d,
    counts: { aggregatesN: agg.totals.n, dealsInWindow: windowDeals.length },
    links: { dashboard: `${base}/`, methodology: `${base}/methodology?profile=${profile.id}`, settings: `${base}/settings`, share: null, health: `${base}/health` },
    disclosure: SIMULATED_PORTFOLIO_FOOTER,
    rejected,
    heldAlerts: held.map((h) => ({ id: Number(h.id), severity: h.severity, title: h.title, body: h.body })),
  };
}

// ─── Persistence ───────────────────────────────────────────────────────────

export async function persistDigest(content: DigestContent): Promise<{ id: number; shareToken: string }> {
  const db = getDb();
  const shareToken = randomBytes(18).toString("base64url");
  content.links.share = `${appUrl()}/share/${shareToken}`;
  const [row] = await db
    .insert(digests)
    .values({
      profileId: content.profile.id,
      mode: content.mode,
      windowStart: new Date(`${content.window.start}T00:00:00Z`),
      windowEnd: new Date(content.generatedAt),
      isoWeek: content.isoWeek,
      headline: content.headline,
      tldr: content.tldr,
      narrative: content.narrative,
      aggregates: { kpis: content.kpis, sectorHeat: content.sectorHeat, stages: content.stages, counts: content.counts },
      content: content as unknown as object,
      rejected: content.rejected,
      shareToken,
    })
    .returning({ id: digests.id });
  if (!row) throw new Error("failed to persist digest");
  const items: { digestId: number; dealId: string | null; eventId: string | null; section: string; rank: number }[] = [];
  content.watchlistHits.forEach((d, i) => items.push({ digestId: row.id, dealId: d.id, eventId: null, section: "watchlist", rank: i }));
  content.adjacency.forEach((a, i) => items.push({ digestId: row.id, dealId: a.deal.id, eventId: null, section: "adjacency", rank: i }));
  [...content.ranked.act_now, ...content.ranked.high, ...content.ranked.relevant].forEach((d, i) => items.push({ digestId: row.id, dealId: d.id, eventId: null, section: "ranked", rank: i }));
  content.serendipity.forEach((d, i) => items.push({ digestId: row.id, dealId: d.id, eventId: null, section: "outside_mandate", rank: i }));
  content.exits.forEach((e, i) => items.push({ digestId: row.id, dealId: null, eventId: e.id, section: "exits", rank: i }));
  content.fundCloses.forEach((e, i) => items.push({ digestId: row.id, dealId: null, eventId: e.id, section: "fund_closes", rank: i }));
  content.founders.forEach((e, i) => items.push({ digestId: row.id, dealId: null, eventId: e.id, section: "people", rank: i }));
  if (items.length) await db.insert(digestItems).values(items).onConflictDoNothing();
  await db.update(digests).set({ content: content as unknown as object }).where(eq(digests.id, row.id));
  return { id: row.id, shareToken };
}

export async function loadProfileWithName(id: string): Promise<(ProfileRow & { displayName: string }) | null> {
  const profiles = await loadProfiles();
  const p = profiles.find((x) => x.id === id);
  if (!p) return null;
  const db = getDb();
  const [row] = await db.execute(sql`SELECT display_name FROM profiles WHERE id = ${id}`).then((r) => r.rows as { display_name: string }[]);
  return { ...p, displayName: row?.display_name ?? id };
}
