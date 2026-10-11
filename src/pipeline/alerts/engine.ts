import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getAggregates } from "@/db/queries/aggregates";
import { isoWeekMonday, latestCompletedWeek, addWeeks } from "@/db/queries/detection";
import { getWatchedInvestors } from "@/db/queries/investors";
import { alerts } from "@/db/schema";
import { renderAlertEmail } from "@/emails/alert";
import { getEnv } from "@/lib/env";
import { usd } from "@/lib/format";
import { runLogger } from "@/lib/logger";
import { startStage, type StageCounters } from "@/lib/run-log";
import { localParts, recipientsFor, sendEmail } from "@/pipeline/deliver";
import type { StageResult } from "@/pipeline/ingest/collect";
import { normalizeCompanyName, toIsoDate } from "@/pipeline/normalize";
import { loadProfiles, type ProfileRow } from "@/pipeline/score";
import { bySeverity, decide, dedupeKey, TRIGGERS, type AlertCandidate, type PolicyState, type TriggerKey } from "./policy";

/**
 * Alerts engine (PRD §15). Event-driven and separate from the digest
 * scheduler: it runs after scoring in every pipeline cycle and again from a
 * second cron after quiet hours end (D-071). Per profile:
 *   1. release queued alerts whose quiet hours have ended,
 *   2. evaluate new candidates (deals/events in the last LOOKBACK_DAYS),
 *      skipping any whose dedupe key already exists,
 *   3. email every pending (admitted) alert.
 * One event never alerts twice: the dedupe key is UNIQUE in the database.
 */

export const LOOKBACK_DAYS = 7;
const num = z.coerce.number();
const numN = z.coerce.number().nullable();
/** "$250K Series A", or "$250K (stage undisclosed)" when the article names no round. */
const round = (amount: number | null, stage: string) => `${usd(amount)} ${stage === "Undisclosed" ? "(stage undisclosed)" : stage}`;

// ─── Candidates ────────────────────────────────────────────────────────────

const REL_TRIGGER: Record<string, TriggerKey> = { competitor: "competitor_raise", same_layer: "same_layer_raise", supplier: "supplier_raise", customer: "supplier_raise", complement: "supplier_raise" };
const REL_TEXT: Record<string, string> = { competitor: "competes with", same_layer: "sells into the same customer and budget as", supplier: "is a supplier to", customer: "is a customer of", complement: "complements" };

export async function gatherCandidates(p: ProfileRow, now: Date): Promise<AlertCandidate[]> {
  const db = getDb();
  const since = toIsoDate(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));
  const out: AlertCandidate[] = [];
  const base = { profileId: p.id, watchlistId: null, eventId: null, subject: null } as const;

  // Adjacency edges on recent deals → competitor / same-layer / supplier raises.
  const edges = z
    .array(z.object({ portfolio_id: num, portfolio: z.string(), deal_id: z.string(), relationship: z.string(), confidence: num, rationale: z.string(), company: z.string(), stage: z.string(), amount_usd: numN, announced: z.string() }))
    .parse(
      (
        await db.execute(sql`
          SELECT ae.portfolio_id, p.name AS portfolio, ae.deal_id, ae.relationship, ae.confidence, ae.rationale,
                 co.canonical_name AS company, d.round_stage AS stage, d.amount_usd, d.announced_date::text AS announced
          FROM adjacency_edges ae JOIN portfolio p ON p.id = ae.portfolio_id JOIN deals d ON d.id = ae.deal_id JOIN companies co ON co.id = d.company_id
          WHERE ae.profile_id = ${p.id} AND p.is_active AND d.announced_date >= ${since}::date`)
      ).rows,
    );
  for (const e of edges) {
    const trigger = REL_TRIGGER[e.relationship];
    if (!trigger) continue;
    const icon = e.relationship === "competitor" ? "🔴 Competitor alert" : e.relationship === "same_layer" ? "🟠 Same-layer raise" : "🔵 Adjacent raise";
    out.push({
      ...base,
      triggerKey: trigger,
      portfolioId: e.portfolio_id,
      dealId: e.deal_id,
      amountUsd: e.amount_usd,
      title: `${icon}: ${e.company} raised ${round(e.amount_usd, e.stage)} — ${REL_TEXT[e.relationship] ?? "is adjacent to"} ${e.portfolio}`,
      body: `${e.company} raised ${usd(e.amount_usd)} (${e.stage}, ${e.announced}). Why flagged: ${e.rationale} (confidence ${e.confidence.toFixed(2)}). ${e.portfolio} is a tracked company in a simulated portfolio.`,
    });
  }

  // Watchlist investors backing adjacent companies.
  const { watched } = await getWatchedInvestors(p.id);
  if (watched.length && edges.length) {
    const ids = [...new Set(edges.map((e) => e.deal_id))];
    const backers = z
      .array(z.object({ deal_id: z.string(), investor_id: num, name: z.string() }))
      .parse(
        (
          await db.execute(sql`SELECT DISTINCT di.deal_id, di.investor_id, i.canonical_name AS name FROM deal_investors di JOIN investors i ON i.id = di.investor_id
                               WHERE di.deal_id IN (${sql.join(ids.map((d) => sql`${d}`), sql`, `)}) AND di.investor_id IN (${sql.join(watched.map((w) => sql`${w.id}`), sql`, `)})`)
        ).rows,
      );
    for (const b of backers) {
      for (const e of edges.filter((x) => x.deal_id === b.deal_id)) {
        out.push({
          ...base,
          triggerKey: "tracked_investor_backs_competitor",
          portfolioId: e.portfolio_id,
          dealId: e.deal_id,
          subject: String(b.investor_id),
          amountUsd: e.amount_usd,
          title: `🔵 ${b.name} (watchlist) backed ${e.company}, adjacent to ${e.portfolio}`,
          body: `${b.name}, on your watchlist, invested in ${e.company} (${e.stage}, ${usd(e.amount_usd)}), which ${REL_TEXT[e.relationship] ?? "is adjacent to"} tracked company ${e.portfolio}.`,
        });
      }
    }
  }

  // Watchlist company raises (the scorecard already carries the watchlist override).
  const hits = z
    .array(z.object({ deal_id: z.string(), company: z.string(), stage: z.string(), amount_usd: numN, announced: z.string(), watchlist_id: numN }))
    .parse(
      (
        await db.execute(sql`
          SELECT d.id AS deal_id, co.canonical_name AS company, d.round_stage AS stage, d.amount_usd, d.announced_date::text AS announced,
                 (SELECT w.id FROM watchlist w WHERE w.profile_id = ${p.id} AND w.watch_type = 'company' AND w.status <> 'removed'
                    AND (w.normalized_value = co.normalized_name OR w.company_id = co.id) LIMIT 1) AS watchlist_id
          FROM relevance_scores rs JOIN deals d ON d.id = rs.deal_id JOIN companies co ON co.id = d.company_id
          WHERE rs.profile_id = ${p.id} AND d.announced_date >= ${since}::date AND rs.breakdown -> 'overrides' @> '[{"key":"watchlist"}]'::jsonb`)
      ).rows,
    );
  for (const h of hits) {
    out.push({
      ...base,
      triggerKey: "watchlist_raise",
      portfolioId: null,
      watchlistId: h.watchlist_id,
      dealId: h.deal_id,
      amountUsd: h.amount_usd,
      title: `🔴 Watchlist: ${h.company} raised ${round(h.amount_usd, h.stage)}`,
      body: `${h.company}, on your watchlist, raised ${usd(h.amount_usd)} (${h.stage}, ${h.announced}).`,
    });
  }

  // Tracked companies appearing in a deal or an event.
  const tracked = z
    .array(z.object({ id: num, name: z.string(), sector: z.string() }))
    .parse((await db.execute(sql`SELECT id, name, sector FROM portfolio WHERE profile_id = ${p.id} AND is_active`)).rows);
  if (tracked.length) {
    const norms = tracked.map((t) => normalizeCompanyName(t.name));
    const own = z
      .array(z.object({ deal_id: z.string(), norm: z.string(), stage: z.string(), amount_usd: numN, announced: z.string() }))
      .parse(
        (
          await db.execute(sql`SELECT d.id AS deal_id, co.normalized_name AS norm, d.round_stage AS stage, d.amount_usd, d.announced_date::text AS announced
                               FROM deals d JOIN companies co ON co.id = d.company_id
                               WHERE d.announced_date >= ${since}::date AND co.normalized_name IN (${sql.join(norms.map((n) => sql`${n}`), sql`, `)})`)
        ).rows,
      );
    for (const d of own) {
      const t = tracked[norms.indexOf(d.norm)];
      if (!t) continue;
      out.push({ ...base, triggerKey: "portfolio_mentioned", portfolioId: t.id, dealId: d.deal_id, amountUsd: d.amount_usd, title: `🟠 Tracked company in a deal: ${t.name} — ${d.stage}, ${usd(d.amount_usd)}`, body: `${t.name} (tracked company) appears in a ${d.stage} round of ${usd(d.amount_usd)} announced ${d.announced}.` });
    }
    const evs = z
      .array(z.object({ name: z.string(), id: z.string(), type: z.string(), headline: z.string(), date: z.string() }))
      .parse(
        (
          await db.execute(sql`SELECT n.name, e.id, e.event_type AS type, e.headline, e.event_date::text AS date
                               FROM json_array_elements_text(${JSON.stringify(tracked.map((t) => t.name))}::json) AS n(name)
                               JOIN events e ON e.event_date >= ${since}::date AND (e.headline ILIKE '%' || n.name || '%' OR e.detail ILIKE '%' || n.name || '%')`)
        ).rows,
      );
    for (const e of evs) {
      const t = tracked.find((x) => x.name === e.name);
      if (!t) continue;
      out.push({ ...base, triggerKey: "portfolio_mentioned", portfolioId: t.id, dealId: null, eventId: e.id, amountUsd: null, title: `🟠 Tracked company in the news: ${t.name} — ${e.headline.slice(0, 90)}`, body: `${e.type.replace("_", " ")} (${e.date}): ${e.headline}` });
    }
  }

  // M&A and shutdowns of companies adjacent to a tracked company (via any of their deals' edges).
  const exits = z
    .array(z.object({ id: z.string(), type: z.string(), headline: z.string(), date: z.string(), portfolio_id: num, portfolio: z.string(), relationship: z.string() }))
    .parse(
      (
        await db.execute(sql`
          SELECT DISTINCT ON (e.id, ae.portfolio_id) e.id, e.event_type AS type, e.headline, e.event_date::text AS date, ae.portfolio_id, p.name AS portfolio, ae.relationship
          FROM events e
          JOIN deals d ON d.company_id IN (e.company_id, e.counterparty_company_id)
          JOIN adjacency_edges ae ON ae.deal_id = d.id AND ae.profile_id = ${p.id}
          JOIN portfolio p ON p.id = ae.portfolio_id AND p.is_active
          WHERE e.event_type IN ('ma', 'shutdown') AND e.event_date >= ${since}::date
          ORDER BY e.id, ae.portfolio_id, ae.confidence DESC`)
      ).rows,
    );
  for (const e of exits) {
    const acquired = e.type === "ma";
    out.push({
      ...base,
      triggerKey: acquired ? "competitor_acquired" : "competitor_shutdown",
      portfolioId: e.portfolio_id,
      dealId: null,
      eventId: e.id,
      amountUsd: null,
      title: `${acquired ? "🟠 Acquisition" : "🟡 Shutdown"}: ${e.headline.slice(0, 90)} — adjacent to ${e.portfolio}`,
      body: `${e.headline} (${e.date}). The company was previously flagged as ${e.relationship.replace("_", " ")} to tracked company ${e.portfolio}.`,
    });
  }

  // Adjacency cluster (§13.3): ≥ threshold competitor/same-layer raises within the window.
  const winStart = toIsoDate(new Date(now.getTime() - p.config.alerts.cluster_window_days * 86_400_000));
  const close = z
    .array(z.object({ portfolio_id: num, portfolio: z.string(), deal_id: z.string(), company: z.string(), announced: z.string() }))
    .parse(
      (
        await db.execute(sql`
          SELECT ae.portfolio_id, p.name AS portfolio, ae.deal_id, co.canonical_name AS company, d.announced_date::text AS announced
          FROM adjacency_edges ae JOIN portfolio p ON p.id = ae.portfolio_id JOIN deals d ON d.id = ae.deal_id JOIN companies co ON co.id = d.company_id
          WHERE ae.profile_id = ${p.id} AND p.is_active AND ae.relationship IN ('competitor', 'same_layer') AND d.announced_date >= ${winStart}::date
          ORDER BY d.announced_date, ae.deal_id`)
      ).rows,
    );
  for (const pid of [...new Set(close.map((c) => c.portfolio_id))]) {
    const members = close.filter((c) => c.portfolio_id === pid);
    const k = p.config.alerts.cluster_threshold;
    const crossing = members[k - 1];
    if (!crossing) continue;
    out.push({
      ...base,
      triggerKey: "adjacency_cluster",
      portfolioId: pid,
      // Keyed on the raise that crossed the threshold, so one cluster alerts once.
      dealId: crossing.deal_id,
      amountUsd: null,
      title: `🟡 Cluster: ${members.length} companies adjacent to ${crossing.portfolio} raised in ${p.config.alerts.cluster_window_days} days`,
      body: `${members.map((m) => `${m.company} (${m.announced})`).join(", ")} — competitor or same-layer raises around tracked company ${crossing.portfolio}.`,
    });
  }

  out.push(...(await momentumFlips(p, tracked, now)));
  return out;
}

/** accelerating ≥ +1σ, cooling ≤ −1σ vs the trailing 8 weeks; a flip is a move from one to the other between consecutive completed weeks. */
export function momentumState(z: number): "accelerating" | "cooling" | "steady" {
  return z >= 1 ? "accelerating" : z <= -1 ? "cooling" : "steady";
}

async function momentumFlips(p: ProfileRow, tracked: { id: number; name: string; sector: string }[], now: Date): Promise<AlertCandidate[]> {
  if (tracked.length === 0) return [];
  const week = latestCompletedWeek(now);
  const prev = addWeeks(week, -1);
  const span = (w: string) => {
    const mon = isoWeekMonday(w);
    return { start: toIsoDate(mon), end: toIsoDate(new Date(mon.getTime() + 6 * 86_400_000)) };
  };
  const [cur, before] = await Promise.all([getAggregates(span(week)), getAggregates(span(prev))]);
  const out: AlertCandidate[] = [];
  for (const sector of [...new Set(tracked.map((t) => t.sector))]) {
    const a = momentumState(before.sectors.rows.find((r) => r.sector === sector)?.z ?? 0);
    const b = momentumState(cur.sectors.rows.find((r) => r.sector === sector)?.z ?? 0);
    if (a === "steady" || b === "steady" || a === b) continue;
    for (const t of tracked.filter((x) => x.sector === sector)) {
      out.push({
        profileId: p.id,
        triggerKey: "sector_momentum_flip",
        portfolioId: t.id,
        watchlistId: null,
        dealId: null,
        eventId: null,
        subject: week,
        amountUsd: null,
        title: `🟡 ${sector} flipped from ${a} to ${b} (${week}) — sector of tracked company ${t.name}`,
        body: `${sector} deal flow moved from ${a} in ${prev} to ${b} in ${week} against its trailing 8-week baseline.`,
      });
    }
  }
  return out;
}

// ─── Policy state from the alert log ───────────────────────────────────────

async function policyState(p: ProfileRow, now: Date): Promise<PolicyState> {
  const rows = z
    .array(z.object({ status: z.string(), portfolio_id: numN, created_at: z.coerce.date(), sent_at: z.coerce.date().nullable() }))
    .parse(
      (
        await getDb().execute(sql`SELECT status, portfolio_id, created_at, sent_at FROM alerts
                                  WHERE profile_id = ${p.id} AND status IN ('sent', 'pending') AND created_at >= now() - interval '48 hours'`)
      ).rows,
    );
  const tz = p.config.delivery.timezone;
  const today = localParts(now, tz).date;
  const last = new Map<number, number>();
  for (const r of rows) {
    const t = (r.sent_at ?? r.created_at).getTime();
    if (r.portfolio_id !== null && now.getTime() - t < 24 * 3_600_000) last.set(r.portfolio_id, Math.max(last.get(r.portfolio_id) ?? 0, t));
  }
  return {
    enabled: p.config.alerts.enabled,
    triggersEnabled: p.config.alerts.triggers_enabled,
    severityThreshold: p.config.alerts.severity_threshold,
    quietHours: p.config.alerts.quiet_hours,
    localTime: localParts(now, tz).hhmm,
    maxImmediatePerDay: p.config.alerts.max_immediate_per_day,
    sentToday: rows.filter((r) => localParts(r.sent_at ?? r.created_at, tz).date === today).length,
    lastImmediateByPortfolio: last,
    nowMs: now.getTime(),
  };
}

// ─── Run ───────────────────────────────────────────────────────────────────

export interface ProfileAlertResult {
  profileId: string;
  candidates: number;
  duplicates: number;
  created: Record<string, number>;
  released: number;
  sent: number;
  sendErrors: string[];
}

export async function runAlertsForProfile(p: ProfileRow, opts: { send: boolean; now?: Date; counters?: StageCounters }): Promise<ProfileAlertResult> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const res: ProfileAlertResult = { profileId: p.id, candidates: 0, duplicates: 0, created: {}, released: 0, sent: 0, sendErrors: [] };
  const st = await policyState(p, now);

  // 1. Release queued alerts (older first) now that quiet hours may have ended.
  const queued = z
    .array(z.object({ id: num, trigger_key: z.string(), portfolio_id: numN }))
    .parse((await db.execute(sql`SELECT id, trigger_key, portfolio_id FROM alerts WHERE profile_id = ${p.id} AND status = 'queued' ORDER BY created_at, id`)).rows);
  for (const q of bySeverity(queued.map((x) => ({ ...x, triggerKey: x.trigger_key as TriggerKey })))) {
    const d = decide({ triggerKey: q.triggerKey, portfolioId: q.portfolio_id, amountUsd: null }, st, true);
    if (d.status === "queued") continue;
    await db.execute(sql`UPDATE alerts SET status = ${d.status}, suppressed_reason = ${d.status === "pending" ? "released after quiet hours" : d.reason}, updated_at = now() WHERE id = ${q.id}`);
    res.released++;
  }

  // 2. New candidates; existing dedupe keys are skipped (and the UNIQUE index backs that up).
  const cands = await gatherCandidates(p, now);
  res.candidates = cands.length;
  const keyed = new Map<string, AlertCandidate>();
  for (const c of cands) keyed.set(dedupeKey(c), c); // identical candidates in one run collapse here
  const keys = [...keyed.keys()];
  const existing = keys.length
    ? new Set(z.array(z.object({ dedupe_key: z.string() })).parse((await db.execute(sql`SELECT dedupe_key FROM alerts WHERE dedupe_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`)).rows).map((r) => r.dedupe_key))
    : new Set<string>();
  const fresh = bySeverity([...keyed.entries()].filter(([k]) => !existing.has(k)).map(([key, c]) => ({ ...c, key })));
  res.duplicates = cands.length - fresh.length;
  for (const c of fresh) {
    const d = decide(c, st);
    const inserted = await db
      .insert(alerts)
      .values({
        profileId: p.id,
        severity: TRIGGERS[c.triggerKey].severity,
        triggerKey: c.triggerKey,
        portfolioId: c.portfolioId,
        watchlistId: c.watchlistId,
        dealId: c.dealId,
        eventId: c.eventId,
        title: c.title,
        body: c.body,
        dedupeKey: c.key,
        status: d.status,
        suppressedReason: d.reason,
      })
      .onConflictDoNothing({ target: alerts.dedupeKey })
      .returning({ id: alerts.id });
    if (inserted.length) res.created[d.status] = (res.created[d.status] ?? 0) + 1;
    else res.duplicates++;
  }

  // 3. Email every admitted alert.
  if (opts.send) {
    const env = getEnv();
    const pending = z.array(z.object({ id: num })).parse((await db.execute(sql`SELECT id FROM alerts WHERE profile_id = ${p.id} AND status = 'pending' ORDER BY id`)).rows);
    for (const { id } of pending) {
      if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
        await db.execute(sql`UPDATE alerts SET suppressed_reason = 'email not configured; will send once RESEND_API_KEY and EMAIL_FROM are set', updated_at = now() WHERE id = ${id}`);
        continue;
      }
      const email = await renderAlertEmail(id);
      if (!email) continue;
      const r = await sendEmail({ to: recipientsFor(p.config), subject: email.subject, html: email.html, text: email.text, idempotencyKey: `alert-${id}` });
      if (r.ok) {
        await db.execute(sql`UPDATE alerts SET status = 'sent', sent_at = now(), suppressed_reason = NULL, updated_at = now() WHERE id = ${id}`);
        res.sent++;
      } else {
        // Stays pending: the next run retries; the dedupe key prevents a second alert row.
        await db.execute(sql`UPDATE alerts SET suppressed_reason = ${`send failed: ${(r.error ?? "unknown").slice(0, 200)}`}, updated_at = now() WHERE id = ${id}`);
        res.sendErrors.push(r.error ?? "send failed");
      }
    }
  }
  return res;
}

/** Dispatcher stage and second-cron entry. One profile failing never blocks the others. */
export async function runAlerts(opts: { runId: string; cursor: string | null; deadline: number; send?: boolean }): Promise<StageResult> {
  const log = runLogger(opts.runId, "alerts");
  const stage = await startStage(opts.runId, "alerts");
  const env = getEnv();
  const send = opts.send ?? (!!env.RESEND_API_KEY && !!env.EMAIL_FROM);
  const results: (ProfileAlertResult | { profileId: string; error: string })[] = [];
  for (const p of await loadProfiles()) {
    try {
      results.push(await runAlertsForProfile(p, { send, counters: stage.counters }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("alerts failed for profile", { profile: p.id, error: message });
      results.push({ profileId: p.id, error: message });
    }
  }
  const failed = results.filter((r) => "error" in r).length;
  stage.counters.itemsIn = results.reduce((n, r) => n + ("candidates" in r ? r.candidates : 0), 0);
  stage.counters.itemsOut = results.reduce((n, r) => n + ("sent" in r ? r.sent : 0), 0);
  await stage.finish(failed === 0 ? "ok" : failed === results.length ? "error" : "partial", { send, results });
  log.info("alerts done", { results });
  return { processed: results.length, next_cursor: null };
}
