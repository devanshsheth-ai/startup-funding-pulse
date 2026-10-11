import type { MandateConfig } from "@/config/profile";
import { SECTORS, stageIndex } from "@/lib/taxonomy";

/**
 * The relevance rubric (PRD §11) as a pure function. Every number in a
 * scorecard is reproducible from its inputs, which is what lets /methodology
 * and the deal cards show the full breakdown.
 */

export type Tier = "act_now" | "high" | "relevant" | "context" | "archive";
export type AdjacencyRelationship = "competitor" | "same_layer" | "supplier" | "customer" | "complement";

export interface Component {
  points: number;
  max: number;
  detail: string;
}

export interface Override {
  key: string;
  points: number;
  detail: string;
}

export interface Scorecard {
  total: number;
  tier: Tier;
  excluded: null | { reason: string };
  components: Record<
    "sector_fit" | "stage_fit" | "cheque_fit" | "tracked_investor" | "geography_fit" | "recency" | "ecosystem_significance",
    Component
  > | null;
  overrides: Override[];
  confidence_multiplier: number;
  /** sector + stage + cheque + tracked investor + geography + recency (serendipity gate). */
  mandate_score: number;
  significance_score: number;
  raw_total: number;
  clamped_total: number;
  reason: string;
}

export interface DealFacts {
  companyName: string;
  description: string | null;
  sector: string;
  subSector: string | null;
  stage: string;
  priorRoundStage: string | null;
  amountUsd: number | null;
  city: string | null;
  announcedDate: string; // YYYY-MM-DD
  corroborationCount: number;
  isVerified: boolean;
  investors: { name: string; role: "lead" | "participating" | "existing" }[];
}

export interface ScoringContext {
  config: MandateConfig;
  sectorFit: { fit: number; reason: string };
  /** Normalised watchlist investor names → display name. */
  watchedInvestors: Map<string, string>;
  /** Set when the deal's company is on the watchlist. */
  watchlistCompany: string | null;
  /** Strongest adjacency edge for this profile, if any. */
  adjacency: { relationship: AdjacencyRelationship; portfolioName: string; rationale: string } | null;
  investorFirstMove: { investor: string; sector: string } | null;
  /** Percentile (0..1) of the amount within its stage×sector bucket; null if undisclosed or no bucket. */
  chequePercentile: { value: number; bucket: string; n: number } | null;
  /** Best deal_count percentile (0..1) among the deal's investors. */
  investorTier: { value: number; investor: string } | null;
  window: { start: string; end: string };
  normalizeInvestor: (name: string) => string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const DAY = 86_400_000;

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/** Hard filter (PRD §11.2): excluded sector or keyword → archived, never scored. */
export function exclusionReason(deal: Pick<DealFacts, "sector" | "subSector" | "description" | "companyName">, cfg: MandateConfig): string | null {
  if (cfg.sectors_excluded.includes(deal.sector) && SECTORS.includes(deal.sector)) return `sector "${deal.sector}" is excluded`;
  const text = ` ${[deal.subSector, deal.description, deal.companyName].filter(Boolean).join(" ").toLowerCase()} `;
  for (const kw of cfg.keywords_excluded) {
    const k = kw.toLowerCase().trim();
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(text)) return `matches excluded keyword "${kw}"`;
  }
  return null;
}

export function stageFit(deal: Pick<DealFacts, "stage" | "priorRoundStage">, cfg: MandateConfig, w: number): Component {
  const m = cfg.mandate;
  let stage = deal.stage;
  let note = "";
  if (stageIndex(stage) < 0 && !m.stages.includes(stage) && !m.stages_adjacent.includes(stage)) {
    // Non-ordinal (Debt, Grant, Undisclosed): use the equity stage the article mentions, else 0.
    if (deal.priorRoundStage && stageIndex(deal.priorRoundStage) >= 0) {
      note = ` (via prior round ${deal.priorRoundStage})`;
      stage = deal.priorRoundStage;
    } else {
      return { points: 0, max: w, detail: stage === "Undisclosed" ? "Round not named in the article" : `${stage} round, no equity stage mentioned` };
    }
  }
  if (m.stages.includes(stage)) return { points: w, max: w, detail: `${stage}, in mandate${note}` };
  if (m.stages_adjacent.includes(stage)) return { points: round1(w * 0.5), max: w, detail: `${stage}, adjacent to mandate${note}` };
  const idx = stageIndex(stage);
  const dist = Math.min(...m.stages.map((s) => (stageIndex(s) >= 0 && idx >= 0 ? Math.abs(stageIndex(s) - idx) : 99)));
  if (dist === 1) return { points: round1(w * 0.5), max: w, detail: `${stage}, one step from mandate${note}` };
  if (dist === 2) return { points: round1(w * 0.2), max: w, detail: `${stage}, two steps from mandate${note}` };
  return { points: 0, max: w, detail: `${stage}, outside mandate${note}` };
}

export function chequeFit(amountUsd: number | null, cfg: MandateConfig, w: number): Component {
  const { min, max } = cfg.mandate.round_size_interest_usd;
  const band = `${fmtUsd(min)}–${fmtUsd(max)}`;
  if (amountUsd === null) return { points: round1(w * 0.4), max: w, detail: "Amount undisclosed (neutral, not penalised)" };
  if (amountUsd >= min && amountUsd <= max) return { points: w, max: w, detail: `${fmtUsd(amountUsd)}, within ${band}` };
  if (amountUsd >= min * 0.5 && amountUsd <= max * 1.5) return { points: round1(w * 0.5), max: w, detail: `${fmtUsd(amountUsd)}, within ±50% of ${band}` };
  return { points: 0, max: w, detail: `${fmtUsd(amountUsd)}, outside ${band}` };
}

export function trackedInvestorFit(deal: Pick<DealFacts, "investors">, ctx: Pick<ScoringContext, "watchedInvestors" | "normalizeInvestor">, w: number): Component {
  const share = { lead: 1, participating: 7 / 12, existing: 4 / 12 } as const;
  let best: { pts: number; name: string; role: string } | null = null;
  for (const inv of deal.investors) {
    const display = ctx.watchedInvestors.get(ctx.normalizeInvestor(inv.name));
    if (!display) continue;
    const pts = w * share[inv.role];
    if (!best || pts > best.pts) best = { pts, name: display, role: inv.role };
  }
  return best
    ? { points: round1(best.pts), max: w, detail: `${best.name} (${best.role}), tracked` }
    : { points: 0, max: w, detail: "No tracked investor" };
}

export function geographyFit(city: string | null, cfg: MandateConfig, w: number): Component {
  if (!city) return { points: 0, max: w, detail: "City not reported" };
  if (cfg.mandate.geographies_primary.includes(city)) return { points: w, max: w, detail: `${city}, primary geography` };
  if (cfg.mandate.geographies_secondary.includes(city)) return { points: round1(w * 0.6), max: w, detail: `${city}, secondary geography` };
  return { points: round1(w * 0.2), max: w, detail: `${city}, other city` };
}

export function recencyFit(date: string, window: { start: string; end: string }, w: number): Component {
  const d = Date.parse(`${date}T00:00:00Z`);
  const s = Date.parse(`${window.start}T00:00:00Z`);
  const e = Date.parse(`${window.end}T00:00:00Z`);
  if (d < s) return { points: 0, max: w, detail: "Before the current digest window" };
  const span = Math.max(e - s, DAY);
  const frac = Math.min(1, (d - s) / span);
  const daysAgo = Math.max(0, Math.round((e - d) / DAY));
  return { points: round1(w * frac), max: w, detail: daysAgo === 0 ? "Announced today" : `Announced ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago` };
}

export function significance(deal: Pick<DealFacts, "corroborationCount">, ctx: Pick<ScoringContext, "chequePercentile" | "investorTier">, w: number): Component {
  const cp = ctx.chequePercentile?.value ?? 0;
  const it = ctx.investorTier?.value ?? 0;
  const co = Math.min(deal.corroborationCount / 4, 1);
  const pts = w * (0.5 * cp + 0.3 * it + 0.2 * co);
  const parts = [
    ctx.chequePercentile ? `${Math.round(cp * 100)}th pct cheque for ${ctx.chequePercentile.bucket} (n=${ctx.chequePercentile.n})` : "cheque size unknown",
    ctx.investorTier ? `investor tier ${Math.round(it * 100)}th pct (${ctx.investorTier.investor})` : "no ranked investor",
    `${deal.corroborationCount} source${deal.corroborationCount === 1 ? "" : "s"}`,
  ];
  return { points: round1(pts), max: w, detail: parts.join("; ") };
}

export function tierFor(score: number, cfg: MandateConfig): Tier {
  const t = cfg.tier_thresholds;
  if (score >= t.act_now) return "act_now";
  if (score >= t.high) return "high";
  if (score >= t.relevant) return "relevant";
  if (score >= t.context) return "context";
  return "archive";
}

export function scoreDeal(deal: DealFacts, ctx: ScoringContext): Scorecard {
  const cfg = ctx.config;
  const w = cfg.scoring_weights;

  const excluded = exclusionReason(deal, cfg);
  if (excluded) {
    return {
      total: 0,
      tier: "archive",
      excluded: { reason: excluded },
      components: null,
      overrides: [],
      confidence_multiplier: 1,
      mandate_score: 0,
      significance_score: 0,
      raw_total: 0,
      clamped_total: 0,
      reason: `Excluded: ${excluded}`,
    };
  }

  const components = {
    sector_fit: {
      points: round1(Math.max(0, Math.min(1, ctx.sectorFit.fit)) * w.sector_fit),
      max: w.sector_fit,
      detail: ctx.sectorFit.reason,
    },
    stage_fit: stageFit(deal, cfg, w.stage_fit),
    cheque_fit: chequeFit(deal.amountUsd, cfg, w.cheque_fit),
    tracked_investor: trackedInvestorFit(deal, ctx, w.tracked_investor),
    geography_fit: geographyFit(deal.city, cfg, w.geography_fit),
    recency: recencyFit(deal.announcedDate, ctx.window, w.recency),
    ecosystem_significance: significance(deal, ctx, w.ecosystem_significance),
  };

  const overrides: Override[] = [];
  if (ctx.watchlistCompany) overrides.push({ key: "watchlist", points: w.override_watchlist, detail: `${ctx.watchlistCompany} is on the watchlist` });
  if (ctx.adjacency) {
    const r = ctx.adjacency.relationship;
    const [key, pts, label] =
      r === "competitor"
        ? (["adjacency_competitor", w.override_adjacency_competitor, "Competes with"] as const)
        : r === "same_layer"
          ? (["adjacency_same_layer", w.override_adjacency_same_layer, "Same layer as"] as const)
          : (["adjacency_adjacent", w.override_adjacency_adjacent, `${r[0]?.toUpperCase()}${r.slice(1)} to`] as const);
    overrides.push({ key, points: pts, detail: `${label} ${ctx.adjacency.portfolioName} (tracked company)` });
  }
  if (ctx.investorFirstMove) {
    overrides.push({
      key: "investor_first_move",
      points: w.override_investor_first_move,
      detail: `${ctx.investorFirstMove.investor}'s first deal in ${ctx.investorFirstMove.sector}`,
    });
  }

  const base = Object.values(components).reduce((s, c) => s + c.points, 0);
  const mandateScore = base - components.ecosystem_significance.points;
  const multiplier = deal.corroborationCount <= 1 && !deal.isVerified ? w.confidence_discount_single_source : 1;
  const raw = round1((base + overrides.reduce((s, o) => s + o.points, 0)) * multiplier);
  const clamped = round1(Math.max(0, Math.min(100, raw)));

  // One-line reason: overrides first, then the strongest base components.
  const top = Object.entries(components)
    .filter(([, c]) => c.points > 0)
    .sort((a, b) => b[1].points / b[1].max - a[1].points / a[1].max || b[1].points - a[1].points)
    .slice(0, 2)
    .map(([, c]) => c.detail);
  const reason = [...overrides.map((o) => o.detail), ...top].slice(0, 3).join(" · ") || "Low mandate fit";

  return {
    total: clamped,
    tier: tierFor(clamped, cfg),
    excluded: null,
    components,
    overrides,
    confidence_multiplier: multiplier,
    mandate_score: round1(mandateScore),
    significance_score: components.ecosystem_significance.points,
    raw_total: raw,
    clamped_total: clamped,
    reason,
  };
}

