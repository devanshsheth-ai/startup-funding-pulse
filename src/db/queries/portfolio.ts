import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";

/**
 * Portfolio and watchlist views (PRD §18.4). Tracked companies are a
 * simulated portfolio; nothing here implies ownership.
 */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

export interface TrackedCompany {
  id: number;
  name: string;
  description: string;
  sector: string;
  subSector: string | null;
  stageHeld: string | null;
  relationshipType: string;
  city: string | null;
  keywords: string[];
  isActive: boolean;
}

export async function getTracked(profileId: string, includeInactive = false): Promise<TrackedCompany[]> {
  const res = await getDb().execute(sql`
    SELECT id, name, description, sector, sub_sector, stage_held, relationship_type, city, adjacency_keywords, is_active
    FROM portfolio WHERE profile_id = ${profileId} ${includeInactive ? sql`` : sql`AND is_active`} ORDER BY is_active DESC, name`);
  return z
    .array(z.object({ id: num, name: z.string(), description: z.string(), sector: z.string(), sub_sector: z.string().nullable(), stage_held: z.string().nullable(), relationship_type: z.string(), city: z.string().nullable(), adjacency_keywords: z.array(z.string()), is_active: z.boolean() }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, name: r.name, description: r.description, sector: r.sector, subSector: r.sub_sector, stageHeld: r.stage_held, relationshipType: r.relationship_type, city: r.city, keywords: r.adjacency_keywords, isActive: r.is_active }));
}

export interface TimelineEdge {
  portfolioId: number;
  dealId: string;
  company: string;
  stage: string;
  amountUsd: number | null;
  announced: string;
  relationship: string;
  confidence: number;
  rationale: string;
  sourceUrl: string | null;
  publication: string | null;
}

export async function getAdjacencyTimeline(profileId: string): Promise<TimelineEdge[]> {
  const res = await getDb().execute(sql`
    SELECT ae.portfolio_id, ae.deal_id, co.canonical_name AS company, d.round_stage AS stage, d.amount_usd, d.announced_date::text AS announced,
           ae.relationship, ae.confidence, ae.rationale,
           (SELECT ds.url FROM deal_sources ds WHERE ds.deal_id = d.id ORDER BY ds.is_primary DESC, ds.published_at LIMIT 1) AS source_url,
           (SELECT ds.publication FROM deal_sources ds WHERE ds.deal_id = d.id ORDER BY ds.is_primary DESC, ds.published_at LIMIT 1) AS publication
    FROM adjacency_edges ae JOIN deals d ON d.id = ae.deal_id JOIN companies co ON co.id = d.company_id JOIN portfolio p ON p.id = ae.portfolio_id
    WHERE ae.profile_id = ${profileId} AND p.is_active
    ORDER BY d.announced_date DESC`);
  return z
    .array(z.object({ portfolio_id: num, deal_id: z.string(), company: z.string(), stage: z.string(), amount_usd: numN, announced: z.string(), relationship: z.string(), confidence: num, rationale: z.string(), source_url: z.string().nullable(), publication: z.string().nullable() }))
    .parse(res.rows)
    .map((r) => ({ portfolioId: r.portfolio_id, dealId: r.deal_id, company: r.company, stage: r.stage, amountUsd: r.amount_usd, announced: r.announced, relationship: r.relationship, confidence: r.confidence, rationale: r.rationale, sourceUrl: r.source_url, publication: r.publication }));
}

/**
 * Competitive pressure (PRD §18.4): count and recency of competitor and
 * same-layer raises. Each edge contributes weight × e^(−age/30 days);
 * competitor = 1, same layer = 0.6, other relationships = 0. Pure.
 */
export function pressureScore(edges: { relationship: string; announced: string; confidence: number }[], now: Date): { score: number; competitors: number; sameLayer: number; last30: number } {
  const W: Record<string, number> = { competitor: 1, same_layer: 0.6 };
  let score = 0;
  let last30 = 0;
  for (const e of edges) {
    const w = W[e.relationship] ?? 0;
    if (!w) continue;
    const age = Math.max(0, (now.getTime() - Date.parse(`${e.announced}T00:00:00Z`)) / 86_400_000);
    score += w * e.confidence * Math.exp(-age / 30);
    if (age <= 30) last30++;
  }
  return {
    score: Math.round(score * 100) / 100,
    competitors: edges.filter((e) => e.relationship === "competitor").length,
    sameLayer: edges.filter((e) => e.relationship === "same_layer").length,
    last30,
  };
}

export interface RelatedEvent {
  id: string;
  type: string;
  headline: string;
  date: string;
  url: string | null;
}

/** Events naming a tracked company (subject, counterparty or headline) in the last 180 days. */
export async function getRelatedEvents(names: string[]): Promise<Map<string, RelatedEvent[]>> {
  const out = new Map<string, RelatedEvent[]>();
  if (names.length === 0) return out;
  const res = await getDb().execute(sql`
    SELECT n.name, e.id, e.event_type AS type, e.headline, e.event_date::text AS date,
           (SELECT es.url FROM event_sources es WHERE es.event_id = e.id ORDER BY es.is_primary DESC LIMIT 1) AS url
    FROM json_array_elements_text(${JSON.stringify(names)}::json) AS n(name)
    JOIN events e ON e.event_date >= current_date - 180 AND (e.headline ILIKE '%' || n.name || '%' OR e.detail ILIKE '%' || n.name || '%')
    ORDER BY e.event_date DESC LIMIT 200`);
  for (const r of z.array(z.object({ name: z.string(), id: z.string(), type: z.string(), headline: z.string(), date: z.string(), url: z.string().nullable() })).parse(res.rows)) {
    out.set(r.name, [...(out.get(r.name) ?? []), { id: r.id, type: r.type, headline: r.headline, date: r.date, url: r.url }]);
  }
  return out;
}

export interface WatchRow {
  id: number;
  type: string;
  value: string;
  aliases: string[];
  notes: string | null;
  tags: string[];
  alertsEnabled: boolean;
  status: string;
  lastEvent: string | null;
  lastEventLabel: string | null;
}

/** Watchlist with a derived "last event": the latest deal (company/investor/sector) or keyword match. */
export async function getWatchlist(profileId: string): Promise<WatchRow[]> {
  const res = await getDb().execute(sql`
    SELECT w.id, w.watch_type AS type, w.value, coalesce(w.aliases, '{}') AS aliases, w.notes, coalesce(w.tags, '{}') AS tags, w.alerts_enabled, w.status,
           CASE w.watch_type
             WHEN 'company' THEN (SELECT max(d.announced_date)::text FROM deals d JOIN companies c ON c.id = d.company_id
                                  WHERE c.normalized_name = w.normalized_value OR c.id = w.company_id)
             WHEN 'investor' THEN (SELECT max(d.announced_date)::text FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
                                   WHERE i.normalized_name = w.normalized_value OR i.id = w.investor_id)
             WHEN 'sector' THEN (SELECT max(d.announced_date)::text FROM deals d WHERE lower(d.sector_primary) = lower(w.value))
             ELSE (SELECT max(d.announced_date)::text FROM deals d JOIN companies c ON c.id = d.company_id
                   WHERE c.description ILIKE '%' || w.value || '%' OR d.sub_sector ILIKE '%' || w.value || '%')
           END AS last_event,
           CASE w.watch_type
             WHEN 'company' THEN (SELECT d.round_stage || ' · ' || coalesce(d.amount_raw, 'undisclosed') FROM deals d JOIN companies c ON c.id = d.company_id
                                  WHERE c.normalized_name = w.normalized_value OR c.id = w.company_id ORDER BY d.announced_date DESC LIMIT 1)
             WHEN 'investor' THEN (SELECT 'in ' || c.canonical_name FROM deal_investors di JOIN deals d ON d.id = di.deal_id JOIN investors i ON i.id = di.investor_id
                                   JOIN companies c ON c.id = d.company_id WHERE i.normalized_name = w.normalized_value OR i.id = w.investor_id ORDER BY d.announced_date DESC LIMIT 1)
             ELSE NULL
           END AS last_event_label
    FROM watchlist w WHERE w.profile_id = ${profileId} AND w.status <> 'removed'
    ORDER BY w.watch_type, w.value`);
  return z
    .array(z.object({ id: num, type: z.string(), value: z.string(), aliases: z.array(z.string()), notes: z.string().nullable(), tags: z.array(z.string()), alerts_enabled: z.boolean(), status: z.string(), last_event: z.string().nullable(), last_event_label: z.string().nullable() }))
    .parse(res.rows)
    .map((r) => ({ id: r.id, type: r.type, value: r.value, aliases: r.aliases, notes: r.notes, tags: r.tags, alertsEnabled: r.alerts_enabled, status: r.status, lastEvent: r.last_event, lastEventLabel: r.last_event_label }));
}

/** "Suggested to watch" (PRD §18.8): companies in act-now/high deals over 90 days that are neither watched nor tracked. */
export async function getWatchSuggestions(profileId: string, limit = 10): Promise<{ company: string; dealId: string; score: number; stage: string; sector: string; announced: string }[]> {
  const res = await getDb().execute(sql`
    SELECT DISTINCT ON (co.id) co.canonical_name AS company, d.id AS deal_id, rs.score, d.round_stage AS stage, d.sector_primary AS sector, d.announced_date::text AS announced
    FROM relevance_scores rs JOIN deals d ON d.id = rs.deal_id JOIN companies co ON co.id = d.company_id
    WHERE rs.profile_id = ${profileId} AND rs.tier IN ('act_now', 'high') AND d.announced_date >= current_date - 90
      AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.profile_id = ${profileId} AND w.watch_type = 'company' AND w.status <> 'removed'
                      AND (w.normalized_value = co.normalized_name OR w.company_id = co.id))
      AND NOT EXISTS (SELECT 1 FROM portfolio p WHERE p.profile_id = ${profileId} AND p.is_active AND lower(p.name) = lower(co.canonical_name))
    ORDER BY co.id, rs.score DESC`);
  return z
    .array(z.object({ company: z.string(), deal_id: z.string(), score: num, stage: z.string(), sector: z.string(), announced: z.string() }))
    .parse(res.rows)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ company: r.company, dealId: r.deal_id, score: r.score, stage: r.stage, sector: r.sector, announced: r.announced }));
}
