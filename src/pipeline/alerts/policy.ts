import { sha256 } from "@/pipeline/ingest/url";

/**
 * Alert trigger taxonomy and hygiene rules (PRD §15.1–15.2). Pure: no I/O,
 * so every rule is unit-tested. The engine (engine.ts) gathers candidates and
 * persists what `decide` returns; every outcome — sent, queued, batched,
 * suppressed — is logged with its reason.
 */

export type Severity = "critical" | "high" | "medium" | "info";
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, info: 0 };
export const SEVERITY_ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", info: "🔵" };

export type TriggerKey =
  | "competitor_raise"
  | "watchlist_raise"
  | "same_layer_raise"
  | "portfolio_mentioned"
  | "competitor_acquired"
  | "adjacency_cluster"
  | "competitor_shutdown"
  | "sector_momentum_flip"
  | "supplier_raise"
  | "tracked_investor_backs_competitor";

type Delivery = "immediate" | "digest" | "immediate_if_large";

export const TRIGGERS: Record<TriggerKey, { severity: Severity; delivery: Delivery; label: string }> = {
  competitor_raise: { severity: "critical", delivery: "immediate", label: "Competitor raise" },
  watchlist_raise: { severity: "critical", delivery: "immediate", label: "Watchlist raise" },
  same_layer_raise: { severity: "high", delivery: "immediate_if_large", label: "Same-layer raise" },
  portfolio_mentioned: { severity: "high", delivery: "immediate", label: "Tracked company mentioned" },
  competitor_acquired: { severity: "high", delivery: "immediate", label: "Adjacent company acquired" },
  adjacency_cluster: { severity: "medium", delivery: "immediate", label: "Adjacency cluster" },
  competitor_shutdown: { severity: "medium", delivery: "digest", label: "Adjacent company shut down" },
  sector_momentum_flip: { severity: "medium", delivery: "digest", label: "Sector momentum flip" },
  supplier_raise: { severity: "info", delivery: "digest", label: "Supplier/customer/complement raise" },
  tracked_investor_backs_competitor: { severity: "info", delivery: "digest", label: "Watchlist investor backs adjacent company" },
};

/** Same-layer raises above this go out immediately; smaller ones wait for the digest (§15.1). */
export const SAME_LAYER_IMMEDIATE_USD = 5_000_000;
export const COOLDOWN_MS = 24 * 3_600_000;

export interface AlertCandidate {
  profileId: string;
  triggerKey: TriggerKey;
  portfolioId: number | null;
  watchlistId: number | null;
  dealId: string | null;
  eventId: string | null;
  /** What the alert is about when there is no deal/event (e.g. an ISO week for momentum flips). */
  subject: string | null;
  amountUsd: number | null;
  title: string;
  body: string;
}

/** §15.2 rule 1: sha256(profile_id + trigger_key + portfolio_id + deal_id); event or subject stands in when there is no deal. */
export function dedupeKey(c: Pick<AlertCandidate, "profileId" | "triggerKey" | "portfolioId" | "dealId" | "eventId" | "subject">): string {
  return sha256([c.profileId, c.triggerKey, c.portfolioId ?? "", c.dealId ?? c.eventId ?? c.subject ?? ""].join("|"));
}

export type AlertStatus = "pending" | "queued" | "batched" | "suppressed";

export interface PolicyState {
  enabled: boolean;
  triggersEnabled: Record<string, boolean>;
  severityThreshold: Severity;
  quietHours: [string, string];
  /** Profile-local "HH:MM" now. */
  localTime: string;
  maxImmediatePerDay: number;
  /** Immediate alerts already sent today (profile-local day). Mutated as alerts are admitted. */
  sentToday: number;
  /** Last immediate alert (sent, queued or admitted) per tracked company. Mutated as alerts are admitted. */
  lastImmediateByPortfolio: Map<number, number>;
  nowMs: number;
}

/** True when `hhmm` falls inside [start, end), handling windows that cross midnight. */
export function inQuietHours(hhmm: string, [start, end]: [string, string]): boolean {
  if (start === end) return false;
  return start < end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

/**
 * Decide one alert's fate. `releasing` re-evaluates an already-queued or
 * pending alert: its trigger, severity and delivery rule were checked when it
 * was created, so only quiet hours, cooldown and the daily cap apply again.
 */
export function decide(
  c: { triggerKey: TriggerKey; portfolioId: number | null; amountUsd: number | null },
  st: PolicyState,
  releasing = false,
): { status: AlertStatus; reason: string } {
  const t = TRIGGERS[c.triggerKey];
  if (!releasing) {
    if (!st.enabled) return { status: "suppressed", reason: "alerts disabled for this profile" };
    if (st.triggersEnabled[c.triggerKey] === false) return { status: "suppressed", reason: `trigger ${c.triggerKey} disabled in settings` };
    // The threshold is the bar for interrupting the user (D-072): below it, the alert still fires but waits for the digest.
    if (SEVERITY_RANK[t.severity] < SEVERITY_RANK[st.severityThreshold]) return { status: "batched", reason: `${t.severity} is below the ${st.severityThreshold} threshold for immediate alerts; held for the next digest` };
    if (t.delivery === "digest") return { status: "batched", reason: "next digest (delivery rule for this trigger)" };
    if (t.delivery === "immediate_if_large" && !((c.amountUsd ?? 0) > SAME_LAYER_IMMEDIATE_USD)) return { status: "batched", reason: "next digest: same-layer raise of $5M or less (or undisclosed)" };
  }
  if (inQuietHours(st.localTime, st.quietHours)) return { status: "queued", reason: `quiet hours ${st.quietHours[0]}–${st.quietHours[1]}; released when they end` };
  if (c.portfolioId !== null && t.severity !== "critical") {
    const last = st.lastImmediateByPortfolio.get(c.portfolioId);
    if (last !== undefined && st.nowMs - last < COOLDOWN_MS) return { status: "batched", reason: "cooldown: this tracked company already had an immediate alert in the last 24 h" };
  }
  if (st.sentToday >= st.maxImmediatePerDay) return { status: "batched", reason: `daily cap of ${st.maxImmediatePerDay} immediate alerts reached; folded into the next digest` };
  st.sentToday++;
  if (c.portfolioId !== null) st.lastImmediateByPortfolio.set(c.portfolioId, st.nowMs);
  return { status: "pending", reason: "immediate" };
}

/** Order candidates so the daily cap is spent on the most severe first. */
export function bySeverity<T extends { triggerKey: TriggerKey }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => SEVERITY_RANK[TRIGGERS[b.triggerKey].severity] - SEVERITY_RANK[TRIGGERS[a.triggerKey].severity]);
}
