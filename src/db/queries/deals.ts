import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { DealFilters, EventFilters } from "@/lib/deal-filters";
import type { Scorecard } from "@/pipeline/rubric";

/**
 * Deal and event archive queries behind /explorer, /api/deals, /api/events
 * and the CSV export. Filters arrive already validated (lib/deal-filters);
 * every value is bound as a parameter.
 */

const num = z.coerce.number();
const numN = z.coerce.number().nullable();

const dealRow = z.object({
  id: z.string(),
  company_id: num,
  company: z.string(),
  description: z.string().nullable(),
  domain: z.string().nullable(),
  stage: z.string(),
  stage_raw: z.string().nullable(),
  amount_usd: numN,
  amount_inr: numN,
  amount_raw: z.string().nullable(),
  amount_confidence: z.string().nullable(),
  fx_rate_used: numN,
  fx_rate_date: z.string().nullable(),
  announced: z.string(),
  iso_week: z.string().nullable(),
  sector: z.string(),
  sub_sector: z.string().nullable(),
  city: z.string().nullable(),
  valuation_usd: numN,
  prior_round_stage: z.string().nullable(),
  is_verified: z.boolean(),
  corroboration: num,
  disputed: z.array(z.string()).nullable(),
  ingestion_mode: z.string(),
  score: numN,
  tier: z.string().nullable(),
  reason: z.string().nullable(),
  breakdown: z.unknown().nullable(),
  is_serendipity: z.boolean().nullable(),
  total: num,
});

export interface DealSource {
  publication: string;
  url: string;
  headline: string | null;
  isPrimary: boolean;
  publishedAt: string | null;
}

export interface DealRow {
  id: string;
  companyId: number;
  company: string;
  description: string | null;
  domain: string | null;
  stage: string;
  stageRaw: string | null;
  amountUsd: number | null;
  amountInr: number | null;
  amountRaw: string | null;
  amountConfidence: string | null;
  fxRateUsed: number | null;
  fxRateDate: string | null;
  announced: string;
  isoWeek: string | null;
  sector: string;
  subSector: string | null;
  city: string | null;
  valuationUsd: number | null;
  priorRoundStage: string | null;
  isVerified: boolean;
  corroboration: number;
  disputed: string[];
  ingestionMode: string;
  score: number | null;
  tier: string | null;
  reason: string | null;
  breakdown: Scorecard | null;
  isSerendipity: boolean;
  leads: { id: number; name: string }[];
  participants: { id: number; name: string }[];
  sources: DealSource[];
}

function whereFor(f: DealFilters): SQL {
  const c: SQL[] = [sql`TRUE`];
  if (f.sector.length) c.push(sql`d.sector_primary IN (${sql.join(f.sector.map((s) => sql`${s}`), sql`, `)})`);
  if (f.stage.length) c.push(sql`d.round_stage IN (${sql.join(f.stage.map((s) => sql`${s}`), sql`, `)})`);
  if (f.tier.length && f.profile) c.push(sql`rs.tier IN (${sql.join(f.tier.map((s) => sql`${s}`), sql`, `)})`);
  if (f.city) c.push(sql`d.hq_city ILIKE ${`%${f.city}%`}`);
  if (f.company) c.push(sql`(co.canonical_name ILIKE ${`%${f.company}%`} OR co.description ILIKE ${`%${f.company}%`} OR d.sub_sector ILIKE ${`%${f.company}%`})`);
  if (f.investor)
    c.push(sql`EXISTS (SELECT 1 FROM deal_investors di JOIN investors i ON i.id = di.investor_id
                       WHERE di.deal_id = d.id AND (i.canonical_name ILIKE ${`%${f.investor}%`} OR ${f.investor.toLowerCase()} = ANY (SELECT lower(a) FROM unnest(coalesce(i.aliases, '{}')) a)))`);
  if (f.from) c.push(sql`d.announced_date >= ${f.from}::date`);
  if (f.to) c.push(sql`d.announced_date <= ${f.to}::date`);
  if (f.min_amount !== undefined) c.push(sql`d.amount_usd >= ${f.min_amount}`);
  if (f.max_amount !== undefined) c.push(sql`d.amount_usd <= ${f.max_amount}`);
  if (f.verified) c.push(sql`d.is_verified`);
  if (f.mode) c.push(sql`d.ingestion_mode = ${f.mode}`);
  return sql.join(c, sql` AND `);
}

function orderFor(f: DealFilters): SQL {
  const dir = f.dir === "asc" ? sql`ASC` : sql`DESC`;
  const nulls = sql`NULLS LAST`;
  if (f.sort === "amount") return sql`d.amount_usd ${dir} ${nulls}, d.announced_date DESC, d.id`;
  if (f.sort === "score" && f.profile) return sql`rs.score ${dir} ${nulls}, d.announced_date DESC, d.id`;
  return sql`d.announced_date ${dir}, rs.score DESC NULLS LAST, d.id`;
}

export async function queryDeals(f: DealFilters): Promise<{ rows: DealRow[]; total: number; nextCursor: number | null }> {
  const db = getDb();
  const profile = f.profile ?? "";
  const res = await db.execute(sql`
    SELECT d.id, co.id AS company_id, co.canonical_name AS company, co.description, co.domain,
           d.round_stage AS stage, d.stage_raw, d.amount_usd, d.amount_inr, d.amount_raw, d.amount_confidence,
           d.fx_rate_used, d.fx_rate_date::text, d.announced_date::text AS announced, d.iso_week,
           d.sector_primary AS sector, d.sub_sector, d.hq_city AS city, d.valuation_usd, d.prior_round_stage,
           d.is_verified, d.corroboration_count AS corroboration, d.disputed_fields AS disputed, d.ingestion_mode,
           rs.score, rs.tier, rs.reason, rs.breakdown, rs.is_serendipity,
           count(*) OVER () AS total
    FROM deals d
    JOIN companies co ON co.id = d.company_id
    LEFT JOIN relevance_scores rs ON rs.deal_id = d.id AND rs.profile_id = ${profile}
    WHERE ${whereFor(f)}
    ORDER BY ${orderFor(f)}
    LIMIT ${f.limit} OFFSET ${f.cursor}`);
  const rows = z.array(dealRow).parse(res.rows);
  const total = rows[0]?.total ?? (f.cursor > 0 ? (await countDeals(f)) : 0);
  const hydrated = await hydrate(rows);
  return { rows: hydrated, total, nextCursor: f.cursor + rows.length < total ? f.cursor + rows.length : null };
}

async function countDeals(f: DealFilters): Promise<number> {
  const res = await getDb().execute(sql`SELECT count(*)::int AS n FROM deals d JOIN companies co ON co.id = d.company_id
    LEFT JOIN relevance_scores rs ON rs.deal_id = d.id AND rs.profile_id = ${f.profile ?? ""} WHERE ${whereFor(f)}`);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function hydrate(rows: z.infer<typeof dealRow>[]): Promise<DealRow[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const [srcs, invs] = await Promise.all([
    db.execute(sql`SELECT deal_id, publication, url, headline, is_primary, published_at::text FROM deal_sources WHERE deal_id IN (${idList})
                   ORDER BY is_primary DESC, published_at ASC NULLS LAST`),
    db.execute(sql`SELECT di.deal_id, di.role, i.id, i.canonical_name AS name FROM deal_investors di JOIN investors i ON i.id = di.investor_id
                   WHERE di.deal_id IN (${idList}) ORDER BY i.canonical_name`),
  ]);
  const s = z.array(z.object({ deal_id: z.string(), publication: z.string(), url: z.string(), headline: z.string().nullable(), is_primary: z.boolean(), published_at: z.string().nullable() })).parse(srcs.rows);
  const v = z.array(z.object({ deal_id: z.string(), role: z.string(), id: num, name: z.string() })).parse(invs.rows);
  return rows.map((r) => {
    const mine = v.filter((x) => x.deal_id === r.id);
    const leadIds = new Set(mine.filter((x) => x.role === "lead").map((x) => x.id));
    const uniq = (xs: typeof mine) => [...new Map(xs.map((x) => [x.id, { id: x.id, name: x.name }])).values()];
    return {
      id: r.id,
      companyId: r.company_id,
      company: r.company,
      description: r.description,
      domain: r.domain,
      stage: r.stage,
      stageRaw: r.stage_raw,
      amountUsd: r.amount_usd,
      amountInr: r.amount_inr,
      amountRaw: r.amount_raw,
      amountConfidence: r.amount_confidence,
      fxRateUsed: r.fx_rate_used,
      fxRateDate: r.fx_rate_date,
      announced: r.announced,
      isoWeek: r.iso_week,
      sector: r.sector,
      subSector: r.sub_sector,
      city: r.city,
      valuationUsd: r.valuation_usd,
      priorRoundStage: r.prior_round_stage,
      isVerified: r.is_verified,
      corroboration: r.corroboration,
      disputed: r.disputed ?? [],
      ingestionMode: r.ingestion_mode,
      score: r.score,
      tier: r.tier,
      reason: r.reason,
      breakdown: (r.breakdown as Scorecard | null) ?? null,
      isSerendipity: r.is_serendipity ?? false,
      leads: uniq(mine.filter((x) => x.role === "lead")),
      participants: uniq(mine.filter((x) => x.role !== "lead" && !leadIds.has(x.id))),
      sources: s
        .filter((x) => x.deal_id === r.id)
        .map((x) => ({ publication: x.publication, url: x.url, headline: x.headline, isPrimary: x.is_primary, publishedAt: x.published_at })),
    };
  });
}

export async function getDeal(id: string, profile: string | null): Promise<DealRow | null> {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT d.id, co.id AS company_id, co.canonical_name AS company, co.description, co.domain,
           d.round_stage AS stage, d.stage_raw, d.amount_usd, d.amount_inr, d.amount_raw, d.amount_confidence,
           d.fx_rate_used, d.fx_rate_date::text, d.announced_date::text AS announced, d.iso_week,
           d.sector_primary AS sector, d.sub_sector, d.hq_city AS city, d.valuation_usd, d.prior_round_stage,
           d.is_verified, d.corroboration_count AS corroboration, d.disputed_fields AS disputed, d.ingestion_mode,
           rs.score, rs.tier, rs.reason, rs.breakdown, rs.is_serendipity, 1 AS total
    FROM deals d JOIN companies co ON co.id = d.company_id
    LEFT JOIN relevance_scores rs ON rs.deal_id = d.id AND rs.profile_id = ${profile ?? ""}
    WHERE d.id = ${id}`);
  const rows = z.array(dealRow).parse(res.rows);
  return (await hydrate(rows))[0] ?? null;
}

/** Hydrated deals by id, in the order given (watchlist hits, adjacency, evidence). */
export async function getDealsByIds(ids: string[], profile: string | null): Promise<DealRow[]> {
  if (ids.length === 0) return [];
  const res = await getDb().execute(sql`
    SELECT d.id, co.id AS company_id, co.canonical_name AS company, co.description, co.domain,
           d.round_stage AS stage, d.stage_raw, d.amount_usd, d.amount_inr, d.amount_raw, d.amount_confidence,
           d.fx_rate_used, d.fx_rate_date::text, d.announced_date::text AS announced, d.iso_week,
           d.sector_primary AS sector, d.sub_sector, d.hq_city AS city, d.valuation_usd, d.prior_round_stage,
           d.is_verified, d.corroboration_count AS corroboration, d.disputed_fields AS disputed, d.ingestion_mode,
           rs.score, rs.tier, rs.reason, rs.breakdown, rs.is_serendipity, 1 AS total
    FROM deals d JOIN companies co ON co.id = d.company_id
    LEFT JOIN relevance_scores rs ON rs.deal_id = d.id AND rs.profile_id = ${profile ?? ""}
    WHERE d.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  const rows = await hydrate(z.array(dealRow).parse(res.rows));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// ─── Events ────────────────────────────────────────────────────────────────

export interface EventRow {
  id: string;
  type: string;
  headline: string;
  detail: string | null;
  date: string;
  sector: string | null;
  amountUsd: number | null;
  fundName: string | null;
  fundSizeUsd: number | null;
  personName: string | null;
  moveType: string | null;
  company: string | null;
  ingestionMode: string;
  sources: { publication: string | null; url: string }[];
}

export async function queryEvents(f: EventFilters): Promise<{ rows: EventRow[]; total: number; nextCursor: number | null }> {
  const db = getDb();
  const c: SQL[] = [sql`TRUE`];
  if (f.type.length) c.push(sql`e.event_type IN (${sql.join(f.type.map((t) => sql`${t}`), sql`, `)})`);
  if (f.sector.length) c.push(sql`e.sector_primary IN (${sql.join(f.sector.map((t) => sql`${t}`), sql`, `)})`);
  if (f.from) c.push(sql`e.event_date >= ${f.from}::date`);
  if (f.to) c.push(sql`e.event_date <= ${f.to}::date`);
  if (f.q) c.push(sql`(e.headline ILIKE ${`%${f.q}%`} OR e.detail ILIKE ${`%${f.q}%`})`);
  const res = await db.execute(sql`
    SELECT e.id, e.event_type AS type, e.headline, e.detail, e.event_date::text AS date, e.sector_primary AS sector,
           e.amount_usd, e.fund_name, e.fund_size_usd, e.person_name, e.move_type, co.canonical_name AS company, e.ingestion_mode,
           coalesce((SELECT json_agg(json_build_object('publication', es.publication, 'url', es.url) ORDER BY es.is_primary DESC)
                     FROM event_sources es WHERE es.event_id = e.id), '[]'::json) AS sources,
           count(*) OVER () AS total
    FROM events e LEFT JOIN companies co ON co.id = e.company_id
    WHERE ${sql.join(c, sql` AND `)}
    ORDER BY e.event_date DESC, e.id LIMIT ${f.limit} OFFSET ${f.cursor}`);
  const rows = z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        headline: z.string(),
        detail: z.string().nullable(),
        date: z.string(),
        sector: z.string().nullable(),
        amount_usd: numN,
        fund_name: z.string().nullable(),
        fund_size_usd: numN,
        person_name: z.string().nullable(),
        move_type: z.string().nullable(),
        company: z.string().nullable(),
        ingestion_mode: z.string(),
        sources: z.array(z.object({ publication: z.string().nullable(), url: z.string() })),
        total: num,
      }),
    )
    .parse(res.rows);
  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      headline: r.headline,
      detail: r.detail,
      date: r.date,
      sector: r.sector,
      amountUsd: r.amount_usd,
      fundName: r.fund_name,
      fundSizeUsd: r.fund_size_usd,
      personName: r.person_name,
      moveType: r.move_type,
      company: r.company,
      ingestionMode: r.ingestion_mode,
      sources: r.sources,
    })),
    total,
    nextCursor: f.cursor + rows.length < total ? f.cursor + rows.length : null,
  };
}

// ─── CSV (PRD §23) ─────────────────────────────────────────────────────────

export const DEALS_CSV_HEADER = [
  "deal_id", "company", "description", "round_stage", "stage_raw", "amount_usd", "amount_inr", "amount_raw", "amount_confidence",
  "fx_rate_used", "fx_rate_date", "announced_date", "iso_week", "sector_primary", "sub_sector", "hq_city", "valuation_usd",
  "prior_round_stage", "lead_investors", "participating_investors", "relevance_score", "tier", "reason", "primary_source_url",
  "all_source_urls", "corroboration_count", "is_verified", "disputed_fields", "ingestion_mode",
];

export function dealCsvRow(d: DealRow): unknown[] {
  const primary = d.sources.find((s) => s.isPrimary) ?? d.sources[0];
  return [
    d.id, d.company, d.description, d.stage, d.stageRaw, d.amountUsd, d.amountInr, d.amountRaw, d.amountConfidence,
    d.fxRateUsed, d.fxRateDate, d.announced, d.isoWeek, d.sector, d.subSector, d.city, d.valuationUsd,
    d.priorRoundStage, d.leads.map((x) => x.name), d.participants.map((x) => x.name), d.score, d.tier, d.reason, primary?.url ?? "",
    d.sources.map((s) => s.url), d.corroboration, d.isVerified, d.disputed, d.ingestionMode,
  ];
}
