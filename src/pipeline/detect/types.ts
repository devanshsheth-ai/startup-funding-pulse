import type { MandateConfig } from "@/config/profile";
import { DETECTORS, type DetectorKey } from "@/config/detectors";
import { addWeeks, type DetectionInput } from "@/db/queries/detection";

export type Confidence = "strong" | "emerging" | "weak_signal";

export interface Finding {
  subject: string;
  title: string;
  /** One factual sentence that includes the statistic. */
  statement: string;
  confidence: Confidence;
  sampleSize: number;
  effectSize: number | null;
  statBasis: Record<string, unknown>;
  evidenceDealIds: string[];
  evidenceEventIds: string[];
}

export type DetectorStatus = "fired" | "quiet" | "suppressed";

export interface DetectorOutcome {
  key: DetectorKey;
  status: DetectorStatus;
  reason: string;
  observed: { n: number | null; effect: number | null; baselineWeeks: number };
  findings: Finding[];
  /** Per-candidate guard log (investor rotation), for debuggability. */
  guardLog?: string[];
}

export interface DetectContext {
  input: DetectionInput;
  /** Calendar weeks of database history before the target week. */
  historyWeeks: number;
  /** The trailing baseline weeks actually available (≤ 8), oldest first. */
  baselineWeeks: string[];
  config: MandateConfig;
  now: Date;
}

export type Detector = (ctx: DetectContext) => DetectorOutcome;

export function gate(key: DetectorKey) {
  return DETECTORS[key];
}

/** History gate: returns a suppression outcome, or null when b_min is met. */
export function historyGate(key: DetectorKey, ctx: DetectContext): DetectorOutcome | null {
  const g = DETECTORS[key];
  if (ctx.historyWeeks >= g.bMin) return null;
  return {
    key,
    status: "suppressed",
    reason: `Only ${ctx.historyWeeks} week${ctx.historyWeeks === 1 ? "" : "s"} of history; needs ${g.bMin}.`,
    observed: { n: null, effect: null, baselineWeeks: ctx.historyWeeks },
    findings: [],
  };
}

export function baselineList(targetWeek: string, historyWeeks: number, max: number): string[] {
  const k = Math.min(max, historyWeeks);
  return Array.from({ length: k }, (_, i) => addWeeks(targetWeek, i - k));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (n: number) => `${r1(n * 100)}%`;

export function usd(n: number): string {
  if (n >= 1e9) return `$${r1(n / 1e9)}B`;
  if (n >= 1e6) return `$${r1(n / 1e6)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

export function quiet(key: DetectorKey, ctx: DetectContext, reason: string, n: number | null, effect: number | null): DetectorOutcome {
  return { key, status: "quiet", reason, observed: { n, effect, baselineWeeks: ctx.baselineWeeks.length }, findings: [] };
}

export function fired(key: DetectorKey, ctx: DetectContext, findings: Finding[], n: number | null, effect: number | null, reason?: string): DetectorOutcome {
  return {
    key,
    status: "fired",
    reason: reason ?? `${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
    observed: { n, effect, baselineWeeks: ctx.baselineWeeks.length },
    findings,
  };
}
