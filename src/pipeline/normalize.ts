import { CITY_MAPPINGS, STAGE_MAPPINGS, ALL_STAGES, INVESTOR_ALIASES } from "@/lib/taxonomy";
import { sha256 } from "@/pipeline/ingest/url";
import type { ExtractedDeal, ExtractedEvent } from "@/pipeline/schemas";

/**
 * Stage C — deterministic normalisation. Pure functions only: no I/O, no LLM.
 * Every function returns null rather than guessing when input is unusable.
 */

// ─── Currency ──────────────────────────────────────────────────────────────

const UNIT_MULTIPLIER: Record<string, number> = {
  crore: 1e7,
  lakh: 1e5,
  million: 1e6,
  billion: 1e9,
  absolute: 1,
};

export interface MoneyInput {
  value: number | null;
  currency: string | null;
  unit: string | null;
}

export interface NormalizedAmount {
  amountInr: number;
  amountUsd: number;
  fxRateUsed: number;
  fxRateDate: string;
}

/**
 * ₹120 crore → INR 1.2e9 → USD at the given USD/INR rate. Crore and lakh
 * only make sense in INR; a "$5 crore" is rejected as inconsistent.
 */
export function normalizeAmount(m: MoneyInput, fx: { usdInr: number; date: string } | null): NormalizedAmount | null {
  if (m.value === null || !Number.isFinite(m.value) || m.value <= 0) return null;
  if (!m.currency || !m.unit || !fx || !(fx.usdInr > 0)) return null;
  const mult = UNIT_MULTIPLIER[m.unit];
  if (mult === undefined) return null;
  if (m.currency === "USD" && (m.unit === "crore" || m.unit === "lakh")) return null;

  const absolute = m.value * mult;
  let inr: number;
  let usd: number;
  if (m.currency === "INR") {
    inr = absolute;
    usd = absolute / fx.usdInr;
  } else if (m.currency === "USD") {
    usd = absolute;
    inr = absolute * fx.usdInr;
  } else {
    return null;
  }
  // Sanity bound: no Indian private round exceeds $20B.
  if (usd > 2e10) return null;
  return { amountInr: Math.round(inr), amountUsd: Math.round(usd), fxRateUsed: fx.usdInr, fxRateDate: fx.date };
}

// ─── Stage ─────────────────────────────────────────────────────────────────

function stageKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9+\- ]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STAGE_KEYS = Object.entries(STAGE_MAPPINGS)
  .map(([k, v]) => [stageKey(k), v] as const)
  .sort((a, b) => b[0].length - a[0].length);

/** Maps a raw phrasing to the canonical enum; `null` means unmapped. */
export function mapStage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (ALL_STAGES.includes(raw)) return raw;
  const key = stageKey(raw);
  if (!key) return null;
  const exact = STAGE_KEYS.find(([k]) => k === key);
  if (exact) return exact[1];
  // Longest phrase contained in the raw text, on word boundaries. Specific
  // stages win over generic phrases ("funding round" → Undisclosed), so
  // "Series C funding round" maps to Series C.
  const contained = STAGE_KEYS.filter(([k]) => new RegExp(`(^| )${k.replace(/[+]/g, "\\+")}( |$)`).test(key));
  const specific = contained.find(([, v]) => v !== "Undisclosed");
  return (specific ?? contained[0])?.[1] ?? null;
}

/** Prefer the LLM's canonical stage, then the raw phrasing, else Undisclosed. */
export function resolveStage(canonical: string | null, raw: string | null): { stage: string; mapped: boolean } {
  if (canonical && ALL_STAGES.includes(canonical)) return { stage: canonical, mapped: true };
  const fromRaw = mapStage(raw);
  if (fromRaw) return { stage: fromRaw, mapped: true };
  return { stage: "Undisclosed", mapped: false };
}

// ─── Names ─────────────────────────────────────────────────────────────────

const LEGAL_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt",
  "limited",
  "ltd",
  "llp",
  "inc",
  "corp",
  "corporation",
  "technologies",
  "technology",
  "labs",
  "india",
];

export function normalizeCompanyName(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing legal/generic suffixes repeatedly ("Foo Technologies Pvt Ltd").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      if (s.endsWith(` ${suf}`) && s.length > suf.length + 1) {
        s = s.slice(0, -(suf.length + 1)).trim();
        changed = true;
      }
    }
  }
  return s;
}

/** Investor names: alias table first, else the cleaned name as given. */
const ALIAS_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(INVESTOR_ALIASES)) {
    m.set(normalizeInvestorKey(canonical), canonical);
    for (const a of aliases) m.set(normalizeInvestorKey(a), canonical);
  }
  return m;
})();

export function normalizeInvestorKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|fund|funds|llp|ltd|limited|pvt)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalInvestorName(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return null;
  // "existing investors", "angel investors" etc. are not entities.
  if (/^(existing|other|several|various|unnamed|undisclosed|angel)\s+(investors?|backers?|angels?)$/i.test(cleaned)) return null;
  return ALIAS_INDEX.get(normalizeInvestorKey(cleaned)) ?? cleaned;
}

// ─── City ──────────────────────────────────────────────────────────────────

export function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z\- ]/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return null;
  if (CITY_MAPPINGS[key]) return CITY_MAPPINGS[key] ?? null;
  // "Bengaluru, Karnataka" → first segment.
  const first = raw.split(/[,/]/)[0]?.toLowerCase().trim() ?? "";
  if (CITY_MAPPINGS[first]) return CITY_MAPPINGS[first] ?? null;
  return raw.split(/[,/]/)[0]?.trim() || null;
}

// ─── Dates ─────────────────────────────────────────────────────────────────

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The deal date: the article's stated date if valid and not in the future,
 * else the publication date. Future dates are rejected (PRD §10 C.4).
 */
export function resolveAnnouncedDate(stated: string | null, publishedAt: Date | null, now: Date): string | null {
  const today = toIsoDate(now);
  if (stated && /^\d{4}-\d{2}-\d{2}$/.test(stated) && !Number.isNaN(Date.parse(stated))) {
    const statedMs = Date.parse(`${stated}T00:00:00Z`);
    const pubMs = publishedAt?.getTime() ?? null;
    // A stated date years before publication is a misread (e.g. founding year).
    const plausible = pubMs === null || Math.abs(pubMs - statedMs) < 120 * 86_400_000;
    if (stated <= today && plausible) return stated;
  }
  if (publishedAt && !Number.isNaN(publishedAt.getTime())) {
    const p = toIsoDate(publishedAt);
    return p <= today ? p : today;
  }
  return null;
}

/** ISO-8601 week key, e.g. "2026-W41". Weeks start Monday; W01 holds 4 Jan. */
export function isoWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── Identity ──────────────────────────────────────────────────────────────

/** deal.id = sha256(normalized_name|round_stage|iso_week) — CLAUDE.md §2. */
export function dealId(normalizedName: string, roundStage: string, week: string): string {
  return sha256(`${normalizedName}|${roundStage}|${week}`);
}

export function eventId(eventType: string, subjectKey: string, week: string): string {
  return sha256(`event|${eventType}|${subjectKey}|${week}`);
}

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

// ─── Candidate builders (Stage C output, Stage D input) ───────────────────


export interface DealCandidate {
  companyName: string;
  normalizedName: string;
  aliases: string[];
  description: string | null;
  domain: string | null;
  roundStage: string;
  stageRaw: string | null;
  stageMapped: boolean;
  amount: NormalizedAmount | null;
  amountRaw: string | null;
  amountConfidence: string;
  announcedDate: string;
  isoWeek: string;
  sectorPrimary: string;
  sectorSecondary: string[];
  subSector: string | null;
  businessModel: string | null;
  hqCity: string | null;
  investors: { lead: string[]; participating: string[]; existing: string[] };
  founders: { name: string; previousCompany: string | null }[];
  foundedYear: number | null;
  valuationUsd: number | null;
  priorRoundStage: string | null;
  priorRoundDate: string | null;
  totalRaisedUsd: number | null;
  extractionConfidence: number;
}

export type BuildResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const GENERIC_NAMES = new Set(["startup", "the startup", "company", "the company", "firm", "the firm", "unnamed", "undisclosed", "stealth", "stealth startup"]);

/** "2024" → 2024-01-01; "2024-03" → 2024-03-01. Future or malformed → null. */
export function normalizePartialDate(raw: string | null, today: string): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const iso = `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}`;
  if (Number.isNaN(Date.parse(iso)) || iso > today) return null;
  return iso;
}

function uniqueInvestors(names: string[], exclude: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set(exclude);
  for (const n of names) {
    const c = canonicalInvestorName(n);
    if (!c) continue;
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export function buildDealCandidate(
  d: ExtractedDeal,
  ctx: { announcedDate: string; fx: { usdInr: number; date: string } | null; today: string },
): BuildResult<DealCandidate> {
  const name = d.company_name.trim();
  const normalizedName = normalizeCompanyName(name);
  if (!normalizedName || normalizedName.length < 2 || GENERIC_NAMES.has(normalizedName)) {
    return { ok: false, reason: `unusable company name "${name}"` };
  }
  const { stage, mapped } = resolveStage(d.round_stage, d.stage_raw);
  const amount = normalizeAmount({ value: d.amount.value, currency: d.amount.currency, unit: d.amount.unit }, ctx.fx);
  const valuation = normalizeAmount({ value: d.valuation.value, currency: d.valuation.currency, unit: d.valuation.unit }, ctx.fx);
  const total = normalizeAmount(
    { value: d.total_raised_to_date.value, currency: d.total_raised_to_date.currency, unit: d.total_raised_to_date.unit },
    ctx.fx,
  );

  const lead = uniqueInvestors(d.investors_lead);
  const leadSet = new Set(lead.map((n) => n.toLowerCase()));
  const participating = uniqueInvestors(d.investors_participating, leadSet);
  const existing = uniqueInvestors(d.investors_existing, new Set([...leadSet, ...participating.map((n) => n.toLowerCase())]));

  return {
    ok: true,
    value: {
      companyName: name,
      normalizedName,
      aliases: [...new Set(d.company_aliases.map((a) => a.trim()).filter((a) => a && a !== name))],
      description: d.company_description?.trim() || null,
      domain: normalizeDomain(d.domain),
      roundStage: stage,
      stageRaw: d.stage_raw,
      stageMapped: mapped,
      amount,
      amountRaw: d.amount.raw,
      amountConfidence: amount ? (d.amount_confidence ?? "reported") : "undisclosed",
      announcedDate: ctx.announcedDate,
      isoWeek: isoWeek(ctx.announcedDate),
      // "Other" is the taxonomy's explicit bucket for unclassifiable (D-025).
      sectorPrimary: d.sector_primary ?? "Other",
      sectorSecondary: d.sector_secondary.filter((s) => s !== d.sector_primary),
      subSector: d.sub_sector,
      businessModel: d.business_model,
      hqCity: normalizeCity(d.hq_city),
      investors: { lead, participating, existing },
      founders: d.founders.map((f) => ({ name: f.name.trim(), previousCompany: f.previous_company?.trim() || null })),
      foundedYear: d.founded_year,
      valuationUsd: valuation?.amountUsd ?? null,
      priorRoundStage: d.prior_round_stage,
      priorRoundDate: normalizePartialDate(d.prior_round_date, ctx.today),
      totalRaisedUsd: total?.amountUsd ?? null,
      extractionConfidence: d.extraction_confidence,
    },
  };
}

export interface EventCandidate {
  eventType: string;
  subjectKey: string;
  headline: string;
  companyName: string | null;
  counterpartyName: string | null;
  amountUsd: number | null;
  eventDate: string;
  isoWeek: string;
  sectorPrimary: string | null;
  hqCity: string | null;
  personName: string | null;
  personRole: string | null;
  moveType: string | null;
  fromCompany: string | null;
  toCompany: string | null;
  fundName: string | null;
  fundSizeUsd: number | null;
  fundVintage: number | null;
  statedFocus: string[];
}

/** The entity an event is "about", for identity and dedupe. */
export function eventSubjectKey(e: ExtractedEvent): string | null {
  switch (e.event_type) {
    case "people_move":
      return e.person_name ? `${normalizeCompanyName(e.person_name)}@${normalizeCompanyName(e.to_company ?? e.from_company ?? "")}` : null;
    case "fund_close":
      return e.fund_name ? normalizeCompanyName(e.fund_name) : e.company_name ? normalizeCompanyName(e.company_name) : null;
    default:
      return e.company_name ? normalizeCompanyName(e.company_name) : null;
  }
}

export function buildEventCandidate(
  e: ExtractedEvent,
  ctx: { eventDate: string; fx: { usdInr: number; date: string } | null },
): BuildResult<EventCandidate> {
  const subjectKey = eventSubjectKey(e);
  if (!subjectKey || subjectKey.length < 2 || GENERIC_NAMES.has(subjectKey)) {
    return { ok: false, reason: `event has no identifiable subject (${e.event_type})` };
  }
  const amount = normalizeAmount({ value: e.amount.value, currency: e.amount.currency, unit: e.amount.unit }, ctx.fx);
  const fund = normalizeAmount({ value: e.fund_size.value, currency: e.fund_size.currency, unit: e.fund_size.unit }, ctx.fx);
  return {
    ok: true,
    value: {
      eventType: e.event_type,
      subjectKey,
      headline: e.summary.trim(),
      companyName: e.company_name?.trim() || null,
      counterpartyName: e.counterparty_name?.trim() || null,
      amountUsd: amount?.amountUsd ?? null,
      eventDate: ctx.eventDate,
      isoWeek: isoWeek(ctx.eventDate),
      sectorPrimary: e.sector_primary,
      hqCity: normalizeCity(e.hq_city),
      personName: e.person_name?.trim() || null,
      personRole: e.person_role?.trim() || null,
      moveType: e.move_type,
      fromCompany: e.from_company?.trim() || null,
      toCompany: e.to_company?.trim() || null,
      fundName: e.fund_name?.trim() || null,
      fundSizeUsd: fund?.amountUsd ?? null,
      fundVintage: e.fund_vintage,
      statedFocus: e.stated_focus,
    },
  };
}
