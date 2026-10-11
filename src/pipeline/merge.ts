/**
 * Deterministic merge of everything the sources reported about one deal
 * (PRD §10 Stage D "On merge", §6.10 field-level confidence). Pure: the deal
 * row is always recomputed from its full source list, so merging is
 * idempotent and order-independent.
 */

export interface SourceReport {
  publication: string;
  publishedAt: Date | null;
  stage: string | null;
  amountUsd: number | null;
  amountRaw: string | null;
  amountConfidence: string | null; // reported | estimated | undisclosed
  investorsLead: string[];
}

export type FieldBadge = "corroborated" | "single_source" | "disputed" | "not_reported";

export interface MergedDeal {
  roundStage: string;
  amountUsd: number | null;
  amountRaw: string | null;
  amountConfidence: string;
  corroborationCount: number;
  hasDisputedField: boolean;
  disputedFields: string[];
  isVerified: boolean;
  primaryIndex: number;
  badges: { amount: FieldBadge; stage: FieldBadge; investors: FieldBadge };
}

const CONFIDENCE_RANK: Record<string, number> = { reported: 3, estimated: 2, undisclosed: 1 };
export const AMOUNT_TOLERANCE = 0.1;

export function amountsAgree(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return hi === 0 || Math.abs(a - b) / hi <= AMOUNT_TOLERANCE;
}

function earliestIndex(reports: SourceReport[]): number {
  let best = 0;
  for (let i = 1; i < reports.length; i++) {
    const a = reports[i]?.publishedAt?.getTime() ?? Infinity;
    const b = reports[best]?.publishedAt?.getTime() ?? Infinity;
    if (a < b) best = i;
  }
  return best;
}

function formatUsd(n: number): string {
  return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;
}

export function mergeReports(reports: SourceReport[]): MergedDeal {
  if (reports.length === 0) throw new Error("mergeReports needs at least one report");
  const publications = new Set(reports.map((r) => r.publication.trim().toLowerCase()));
  const corroborationCount = publications.size;
  const disputed: string[] = [];

  // ── Amount: highest confidence wins; ties go to the most-corroborated value.
  const withAmount = reports
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: SourceReport & { amountUsd: number }; i: number } => x.r.amountUsd !== null && x.r.amountUsd > 0);
  let amountUsd: number | null = null;
  let amountRaw: string | null = null;
  let amountConfidence = "undisclosed";
  let amountBadge: FieldBadge = "not_reported";

  if (withAmount.length > 0) {
    const topRank = Math.max(...withAmount.map((x) => CONFIDENCE_RANK[x.r.amountConfidence ?? "reported"] ?? 3));
    const top = withAmount.filter((x) => (CONFIDENCE_RANK[x.r.amountConfidence ?? "reported"] ?? 3) === topRank);
    const support = (v: number) => withAmount.filter((x) => amountsAgree(x.r.amountUsd, v)).length;
    const chosen = [...top].sort((a, b) => support(b.r.amountUsd) - support(a.r.amountUsd) || a.i - b.i)[0];
    if (chosen) {
      amountUsd = chosen.r.amountUsd;
      amountRaw = chosen.r.amountRaw;
      amountConfidence = chosen.r.amountConfidence ?? "reported";
    }
    const values = withAmount.map((x) => x.r.amountUsd);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (!amountsAgree(lo, hi)) {
      disputed.push("amount");
      amountRaw = `${formatUsd(lo)}–${formatUsd(hi)} (sources disagree)`;
      amountBadge = "disputed";
    } else {
      amountBadge = new Set(withAmount.map((x) => x.r.publication.trim().toLowerCase())).size >= 2 ? "corroborated" : "single_source";
    }
  }

  // ── Stage: Undisclosed defers to any named stage; conflicting named stages dispute.
  const named = reports.map((r) => r.stage).filter((s): s is string => !!s && s !== "Undisclosed");
  let roundStage = "Undisclosed";
  let stageBadge: FieldBadge = "not_reported";
  if (named.length > 0) {
    const counts = new Map<string, number>();
    for (const s of named) counts.set(s, (counts.get(s) ?? 0) + 1);
    roundStage = [...counts.entries()].sort((a, b) => b[1] - a[1] || named.indexOf(a[0]) - named.indexOf(b[0]))[0]?.[0] ?? "Undisclosed";
    if (counts.size > 1) {
      disputed.push("stage");
      stageBadge = "disputed";
    } else {
      const pubs = new Set(reports.filter((r) => r.stage === roundStage).map((r) => r.publication.trim().toLowerCase()));
      stageBadge = pubs.size >= 2 ? "corroborated" : "single_source";
    }
  }

  // ── Lead investors: badge only (the investor union is handled in SQL).
  const leadSets = reports.filter((r) => r.investorsLead.length > 0).map((r) => new Set(r.investorsLead.map((n) => n.toLowerCase())));
  let investorsBadge: FieldBadge = "not_reported";
  if (leadSets.length === 1) investorsBadge = "single_source";
  else if (leadSets.length > 1) {
    const first = leadSets[0] ?? new Set<string>();
    const allOverlap = leadSets.every((s) => [...s].some((n) => first.has(n)));
    investorsBadge = allOverlap ? "corroborated" : "disputed";
  }

  const hasDisputedField = disputed.length > 0;
  return {
    roundStage,
    amountUsd,
    amountRaw,
    amountConfidence,
    corroborationCount,
    hasDisputedField,
    disputedFields: disputed,
    isVerified: corroborationCount >= 2 && !hasDisputedField,
    primaryIndex: earliestIndex(reports),
    badges: { amount: amountBadge, stage: stageBadge, investors: investorsBadge },
  };
}

/** Two stages describe the same round if equal, or if either is Undisclosed. */
export function stagesCompatible(a: string, b: string): boolean {
  return a === b || a === "Undisclosed" || b === "Undisclosed";
}
