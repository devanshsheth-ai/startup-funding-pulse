/**
 * Detector gates (PRD §14.2). Every detector fires only if all three pass:
 *   sample_size ≥ n_min  AND  effect_size ≥ e_min  AND  baseline_weeks ≥ b_min
 * A detector whose b_min is unmet is *suppressed* and shown as such.
 */

export type DetectorKey =
  | "sector_momentum"
  | "stage_shift"
  | "cheque_inflation"
  | "investor_rotation"
  | "thesis_clustering"
  | "syndicate_formation"
  | "followon_compression"
  | "capital_concentration"
  | "geographic_shift"
  | "sector_silence"
  | "outlier_deal"
  | "repeat_founder";

export interface DetectorGate {
  label: string;
  signal: string;
  /** Minimum sample (null where the PRD sets none). */
  nMin: number | null;
  nUnit: string;
  /** Minimum effect (null where the PRD sets none). */
  eMin: number | null;
  eUnit: string;
  /** Minimum weeks of history before the target week. */
  bMin: number;
  bestEffort?: boolean;
  note?: string;
}

export const DETECTORS: Record<DetectorKey, DetectorGate> = {
  sector_momentum: {
    label: "Sector momentum",
    signal: "A sector's deal count this week vs its trailing 8-week mean, in standard deviations (both directions).",
    nMin: 3, nUnit: "deals this week (accelerating) or baseline mean (cooling)",
    eMin: 1.5, eUnit: "σ",
    bMin: 4,
    note: "σ is floored at 1 deal/week so a sector with a flat baseline cannot produce an infinite z-score (D-051).",
  },
  stage_shift: {
    label: "Stage shift",
    signal: "Share of priced capital by stage this week vs the trailing 8-week share.",
    nMin: 5, nUnit: "priced deals this week",
    eMin: 10, eUnit: "percentage points",
    bMin: 4,
  },
  cheque_inflation: {
    label: "Cheque inflation",
    signal: "Median cheque per stage this week vs the trailing 8-week median for that stage.",
    nMin: 4, nUnit: "priced deals at the stage this week",
    eMin: 25, eUnit: "% change",
    bMin: 6,
  },
  investor_rotation: {
    label: "Investor rotation",
    signal: "An established investor's first observed deal in a sector.",
    nMin: 3, nUnit: "deals in the database for the investor",
    eMin: null, eUnit: "",
    bMin: 8,
    note: "Four guards, each logged: ≥3 deals in the database; 0 prior deals in the sector; ≥8 weeks of database history; first seen ≥8 weeks ago (PRD §14.3).",
  },
  thesis_clustering: {
    label: "Thesis clustering",
    signal: "Three or more deals this week whose companies form one tight embedding cluster.",
    nMin: 3, nUnit: "deals in the cluster",
    eMin: 0.75, eUnit: "cohesion (mean pairwise cosine)",
    bMin: 2,
    note: "Cohesion must also exceed the corpus's 99th-percentile pairwise similarity: with this embedding model the median pair already scores ≈0.77, so 0.75 alone would call any three deals a thesis (D-051).",
  },
  syndicate_formation: {
    label: "Syndicate formation",
    signal: "An investor pair co-investing repeatedly, including this week.",
    nMin: 3, nUnit: "co-investments",
    eMin: 2.0, eUnit: "lift (observed ÷ expected)",
    bMin: 8,
  },
  followon_compression: {
    label: "Follow-on compression",
    signal: "Median months between a company's rounds, recent 4 weeks vs earlier history.",
    nMin: 4, nUnit: "recent round pairs",
    eMin: 20, eUnit: "% shorter",
    bMin: 8,
    note: "Round pairs come from 'has raised X to date / previous round' mentions plus consecutive observed rounds.",
  },
  capital_concentration: {
    label: "Capital concentration",
    signal: "Top-3 deals' share of the week's priced capital vs the trailing 8-week mean share.",
    nMin: null, nUnit: "",
    eMin: 15, eUnit: "percentage points",
    bMin: 4,
  },
  geographic_shift: {
    label: "Geographic shift",
    signal: "A city's share of deals this week vs the trailing 8-week share (deals with a reported city).",
    nMin: 4, nUnit: "deals in the city this week",
    eMin: 10, eUnit: "percentage points",
    bMin: 4,
    note: "Also needs ≥20 baseline deals with a reported city; weekly roundups rarely name cities, so this stays suppressed until live history accumulates (D-051).",
  },
  sector_silence: {
    label: "Sector silence",
    signal: "A mandate core sector with zero deals for 3 or more consecutive weeks.",
    nMin: null, nUnit: "",
    eMin: 3, eUnit: "consecutive silent weeks",
    bMin: 6,
  },
  outlier_deal: {
    label: "Outlier deal",
    signal: "A deal more than 2σ from its stage × sector distribution (log scale), falling back to stage-only.",
    nMin: 8, nUnit: "priced deals in the bucket",
    eMin: 2.0, eUnit: "σ",
    bMin: 6,
    note: "Amounts are compared on a log10 scale: round sizes are heavy-tailed, so a linear σ is dominated by one mega-round (D-051).",
  },
  repeat_founder: {
    label: "Repeat founder",
    signal: "Founders of two or more of this week's funded startups share a former employer.",
    nMin: 2, nUnit: "deals",
    eMin: null, eUnit: "",
    bMin: 4,
    bestEffort: true,
    note: "Best effort: founder backgrounds are rarely in funding news, so this fires rarely by design.",
  },
};

/** Confidence label from how far the effect clears its gate (D-051). */
export function confidenceFor(effect: number, eMin: number | null): "strong" | "emerging" | "weak_signal" {
  if (eMin === null || eMin === 0) return "emerging";
  const ratio = Math.abs(effect) / eMin;
  if (ratio >= 2) return "strong";
  if (ratio >= 1.33) return "emerging";
  return "weak_signal";
}

export const BASELINE_WEEKS = 8; // fixed regardless of cadence (CLAUDE.md §7.3)
export const MIN_BASELINE_CITY_DEALS = 20;
export const CLUSTER_CORPUS_PERCENTILE = 0.99;
