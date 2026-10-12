import { z } from "zod";
import type { MandateConfig } from "@/config/profile";
import type { Aggregates } from "@/db/queries/aggregates";
import { GeminiOutputError, GeminiUnavailableError, generateStructured } from "@/lib/gemini";
import type { StageCounters } from "@/lib/run-log";

/**
 * Stage I — narration (PRD §10). Gemini reads the Aggregates object, the
 * fired patterns and compact deal/event summaries, never a raw deal list on
 * its own, and returns prose with evidence IDs. The rules that make the
 * prose trustworthy are enforced here in code, after the model replies:
 *   - a paragraph with no valid evidence ID is rejected (invented IDs stripped first)
 *   - ownership language about the simulated portfolio is rejected
 *   - TL;DR and LP bullets without a statistic are dropped
 */

export const weeklyNarrationSchema = z.object({
  headline: z.string().min(1).max(200),
  tldr: z.array(z.string().min(1).max(400)).max(8),
  narrative: z
    .array(
      z.object({
        claim: z.string().min(1).max(1500),
        evidence_deal_ids: z.array(z.string()),
        evidence_event_ids: z.array(z.string()),
        confidence: z.enum(["strong", "emerging", "weak_signal"]),
        stat_basis: z.string().max(400),
      }),
    )
    .max(10),
  lp_talking_points: z.array(z.string().min(1).max(400)).max(8),
  open_questions: z.array(z.string().min(1).max(400)).max(5),
});
export type WeeklyNarration = z.infer<typeof weeklyNarrationSchema>;

export const dailyNarrationSchema = z.object({
  headline: z.string().min(1).max(200),
  context: z.object({ text: z.string().min(1).max(1200), evidence_deal_ids: z.array(z.string()), stat_basis: z.string().max(400) }),
});
export type DailyNarration = z.infer<typeof dailyNarrationSchema>;

export interface NarrativeItem {
  claim: string;
  evidenceDealIds: string[];
  evidenceEventIds: string[];
  confidence: "strong" | "emerging" | "weak_signal";
  statBasis: string;
}

export interface Rejection {
  text: string;
  reason: string;
}

// ─── Enforcement (pure, unit-tested) ───────────────────────────────────────

const OWNERSHIP_PATTERNS: RegExp[] = [
  /\bour\s+(portfolio|fund|investments?|stakes?|holdings?|companies)\b/i,
  /\b(we|i)\s+(have\s+)?(invested|own|hold|backed|funded)\b/i,
  /\b(we|i)\s+(are|am)\s+(invested|an investor)\b/i,
  /\b(holds?|has|have)\s+an?\s+(stake|position)\s+in\b/i,
  /\b(portfolio\s+holding|our\s+holding)\b/i,
];

export function ownershipViolation(text: string, trackedNames: string[]): string | null {
  for (const re of OWNERSHIP_PATTERNS) if (re.test(text)) return `ownership language: "${text.match(re)?.[0] ?? ""}"`;
  for (const name of trackedNames) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b(invested in|stake in|owns?|holds?)\\s+(the\\s+)?${n}\\b`, "i").test(text)) return `ownership language about ${name}`;
  }
  return null;
}

const hasStatistic = (s: string) => /\d/.test(s);

export function enforceNarrative(
  items: WeeklyNarration["narrative"],
  allowed: { deals: Set<string>; events: Set<string> },
  trackedNames: string[],
): { kept: NarrativeItem[]; rejected: Rejection[] } {
  const kept: NarrativeItem[] = [];
  const rejected: Rejection[] = [];
  for (const it of items) {
    const deals = it.evidence_deal_ids.filter((id) => allowed.deals.has(id));
    const events = it.evidence_event_ids.filter((id) => allowed.events.has(id));
    if (deals.length === 0 && events.length === 0) {
      const invented = it.evidence_deal_ids.length + it.evidence_event_ids.length;
      rejected.push({ text: it.claim, reason: invented ? `all ${invented} evidence ID(s) were not in the input` : "no evidence IDs" });
      continue;
    }
    const own = ownershipViolation(it.claim, trackedNames);
    if (own) {
      rejected.push({ text: it.claim, reason: own });
      continue;
    }
    kept.push({ claim: it.claim.trim(), evidenceDealIds: deals, evidenceEventIds: events, confidence: it.confidence, statBasis: it.stat_basis.trim() });
  }
  return { kept, rejected };
}

export function enforceBullets(bullets: string[], trackedNames: string[], requireStat: boolean): { kept: string[]; rejected: Rejection[] } {
  const kept: string[] = [];
  const rejected: Rejection[] = [];
  for (const b of bullets) {
    const own = ownershipViolation(b, trackedNames);
    if (own) rejected.push({ text: b, reason: own });
    else if (requireStat && !hasStatistic(b)) rejected.push({ text: b, reason: "no statistic" });
    else kept.push(b.trim());
  }
  return { kept, rejected };
}

export function fitHeadline(h: string, fallback: string, trackedNames: string[]): string {
  const t = h.trim().replace(/\s+/g, " ");
  if (!t || t.length > 90 || !hasStatistic(t) || ownershipViolation(t, trackedNames)) return fallback;
  return t;
}

// ─── Prompt inputs (compact tables, never a bare deal dump) ────────────────

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

export function formatMandate(cfg: MandateConfig, name: string): string {
  return [
    `Profile: ${name}`,
    `Core sectors: ${cfg.sectors_core.map((s) => `${s.name} (${s.sub.join(", ")})`).join("; ")}`,
    `Watch sectors: ${cfg.sectors_watch.join(", ") || "none"}`,
    `Stages: ${cfg.mandate.stages.join(", ")}; round size of interest ${usd(cfg.mandate.round_size_interest_usd.min)}–${usd(cfg.mandate.round_size_interest_usd.max)}`,
    `Geographies: ${cfg.mandate.geographies_primary.join(", ")}`,
  ].join("\n");
}

export function formatAggregates(a: Aggregates, coreSectors: Set<string>): string {
  const t = a.totals;
  const lines = [
    `Totals (n=${t.n} deals, ${t.priced_n} priced): capital ${usd(t.capital_usd)}; median cheque ${usd(t.median_usd)}; undisclosed ${t.undisclosed_n}; previous window ${t.previous_window.n} deals / ${usd(t.previous_window.capital_usd)}; baseline ${t.baseline_weekly_mean_n.toFixed(1)} deals/week, ${usd(t.baseline_weekly_mean_capital_usd)}/week.`,
    `Market temperature: ${a.temperature.value}/100 (deal count z=${a.temperature.components.deal_count.z.toFixed(2)}, capital z=${a.temperature.components.total_capital.z.toFixed(2)}).`,
    `Capital concentration (n=${a.concentration.n}): top-3 rounds = ${(a.concentration.top3_share * 100).toFixed(1)}% vs ${(a.concentration.baseline_top3_share * 100).toFixed(1)}% baseline.`,
    "",
    `Sectors (n=${a.sectors.n}) | deals | capital | WoW Δ | vs 8-wk mean σ | mandate`,
    ...a.sectors.rows.slice(0, 12).map((s) => `${s.sector} | ${s.n} | ${usd(s.capital)} | ${s.wow_delta >= 0 ? "+" : ""}${s.wow_delta} | ${s.z.toFixed(2)} | ${coreSectors.has(s.sector) ? "core" : ""}`),
    "",
    `Stages (n=${a.stages.n}) | deals | capital | median | share of capital % | baseline share %`,
    ...a.stages.rows.map((s) => `${s.stage} | ${s.n} | ${usd(s.capital)} | ${usd(s.median)} | ${s.share_pct.toFixed(1)} | ${s.baseline_share_pct.toFixed(1)}`),
    "",
    `Cities (n=${a.cities.n} reported, ${a.cities.unreported_n} unreported): ${a.cities.rows.map((c) => `${c.city} ${c.n}`).join(", ") || "none"}`,
    `Most active investors (n=${a.investors.n}): ${a.investors.rows.slice(0, 8).map((i) => `${i.investor} ${i.deals} deals (${i.lead_deals} led)`).join("; ")}`,
    `Events (n=${a.events.n}): ${a.events.by_type.map((e) => `${e.type} ${e.n}`).join(", ") || "none"}; fund-close capital ${usd(a.events.fund_close_capital_usd)}.`,
  ];
  return lines.join("\n");
}

// ─── Calls ─────────────────────────────────────────────────────────────────

/**
 * One retry when the reply fails JSON/schema validation (it happened on 12 Oct and degraded a
 * sent brief). Invalid replies are never cached, so the retry gets a fresh generation.
 */
async function withOutputRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof GeminiOutputError)) throw err;
    return await call();
  }
}

export interface WeeklyNarrationInput {
  mandate: string;
  window: string;
  aggregates: string;
  patterns: string;
  alerts: string;
  deals: string;
  events: string;
}

export interface NarrationResult<T> {
  ok: boolean;
  value: T | null;
  rejected: Rejection[];
  error: string | null;
}

export async function narrateWeekly(
  input: WeeklyNarrationInput,
  allowed: { deals: Set<string>; events: Set<string> },
  trackedNames: string[],
  fallbackHeadline: string,
  counters?: StageCounters,
): Promise<NarrationResult<{ headline: string; tldr: string[]; narrative: NarrativeItem[]; lpTalkingPoints: string[]; openQuestions: string[] }>> {
  try {
    const { data } = await withOutputRetry(() =>
      generateStructured({
        task: "narrate",
        prompt: { name: "narrate-weekly", version: 1 },
        vars: { ...input },
        schema: weeklyNarrationSchema,
        temperature: 0.35,
        counters,
        maxOutputTokens: 8192,
      }),
    );
    const n = enforceNarrative(data.narrative, allowed, trackedNames);
    const tl = enforceBullets(data.tldr, trackedNames, true);
    const lp = enforceBullets(data.lp_talking_points, trackedNames, true);
    const oq = enforceBullets(data.open_questions, trackedNames, false);
    return {
      ok: true,
      value: { headline: fitHeadline(data.headline, fallbackHeadline, trackedNames), tldr: tl.kept.slice(0, 5), narrative: n.kept, lpTalkingPoints: lp.kept.slice(0, 5), openQuestions: oq.kept.slice(0, 3) },
      rejected: [...n.rejected, ...tl.rejected, ...lp.rejected, ...oq.rejected],
      error: null,
    };
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiOutputError) return { ok: false, value: null, rejected: [], error: err.message };
    throw err;
  }
}

export async function narrateDaily(
  vars: { mandate: string; today: string; rolling: string; deals: string; alerts: string },
  allowedDeals: Set<string>,
  trackedNames: string[],
  fallbackHeadline: string,
  counters?: StageCounters,
): Promise<NarrationResult<{ headline: string; context: { text: string; evidenceDealIds: string[]; statBasis: string } | null }>> {
  try {
    const { data } = await withOutputRetry(() =>
      generateStructured({
        task: "narrate",
        prompt: { name: "narrate-daily", version: 1 },
        vars,
        schema: dailyNarrationSchema,
        temperature: 0.3,
        counters,
      }),
    );
    const ids = data.context.evidence_deal_ids.filter((id) => allowedDeals.has(id));
    const own = ownershipViolation(data.context.text, trackedNames);
    const rejected: Rejection[] = [];
    let context: { text: string; evidenceDealIds: string[]; statBasis: string } | null = null;
    if (ids.length === 0) rejected.push({ text: data.context.text, reason: "no valid evidence IDs" });
    else if (own) rejected.push({ text: data.context.text, reason: own });
    else context = { text: data.context.text.trim(), evidenceDealIds: ids, statBasis: data.context.stat_basis };
    return { ok: true, value: { headline: fitHeadline(data.headline, fallbackHeadline, trackedNames), context }, rejected, error: null };
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiOutputError) return { ok: false, value: null, rejected: [], error: err.message };
    throw err;
  }
}
