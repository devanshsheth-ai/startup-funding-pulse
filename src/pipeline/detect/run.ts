import { and, desc, eq, sql } from "drizzle-orm";
import { BASELINE_WEEKS, DETECTORS, type DetectorKey } from "@/config/detectors";
import { getDb } from "@/db/client";
import { detectorRuns, patterns } from "@/db/schema";
import { addWeeks, latestCompletedWeek, loadDetectionInput, weeksBetween } from "@/db/queries/detection";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import type { StageResult } from "@/pipeline/ingest/collect";
import { loadProfiles } from "@/pipeline/score";
import { DETECTOR_FUNCTIONS } from "./index";
import { baselineList, type DetectContext, type DetectorOutcome } from "./types";

/**
 * Stage H — run all twelve detectors for the latest completed ISO week, per
 * profile. Every outcome (fired / quiet / suppressed + reason + gate values)
 * is stored; fired findings become `patterns` rows with consecutive_weeks.
 */

export interface DetectOptions {
  runId: string;
  now?: Date;
  targetWeek?: string;
  /** Test hook: pretend the database has at most this many weeks of history. */
  historyCap?: number;
  /** Write results (default true). */
  persist?: boolean;
}

export async function detectAll(opts: DetectOptions): Promise<{ targetWeek: string; historyWeeks: number; byProfile: Record<string, DetectorOutcome[]> }> {
  const now = opts.now ?? new Date();
  const targetWeek = opts.targetWeek ?? latestCompletedWeek(now);
  const input = await loadDetectionInput(targetWeek, BASELINE_WEEKS);
  let historyWeeks = input.earliestWeek ? Math.max(0, weeksBetween(input.earliestWeek, targetWeek)) : 0;
  if (opts.historyCap !== undefined) historyWeeks = Math.min(historyWeeks, opts.historyCap);
  const baselineWeeks = baselineList(targetWeek, historyWeeks, BASELINE_WEEKS);
  const log = runLogger(opts.runId, "detect");
  const byProfile: Record<string, DetectorOutcome[]> = {};

  for (const profile of await loadProfiles()) {
    const ctx: DetectContext = { input, historyWeeks, baselineWeeks, config: profile.config, now };
    const outcomes = (Object.keys(DETECTOR_FUNCTIONS) as DetectorKey[]).map((k) => DETECTOR_FUNCTIONS[k](ctx));
    byProfile[profile.id] = outcomes;
    for (const o of outcomes) {
      for (const line of o.guardLog ?? []) log.info("investor_rotation guard", { profile: profile.id, line });
    }
    if (opts.persist !== false) await persist(profile.id, targetWeek, outcomes, opts.runId);
  }
  return { targetWeek, historyWeeks, byProfile };
}

async function persist(profileId: string, week: string, outcomes: DetectorOutcome[], runId: string): Promise<void> {
  const db = getDb();
  const prevWeek = addWeeks(week, -1);
  for (const o of outcomes) {
    const g = DETECTORS[o.key];
    await db
      .insert(detectorRuns)
      .values({
        profileId,
        isoWeek: week,
        detectorKey: o.key,
        status: o.status,
        reason: o.reason,
        gates: { n_min: g.nMin, e_min: g.eMin, b_min: g.bMin, observed: o.observed },
        findings: o.findings.length,
        runId,
      })
      .onConflictDoUpdate({
        target: [detectorRuns.profileId, detectorRuns.isoWeek, detectorRuns.detectorKey],
        set: { status: sql`excluded.status`, reason: sql`excluded.reason`, gates: sql`excluded.gates`, findings: sql`excluded.findings`, runId: sql`excluded.run_id`, updatedAt: new Date() },
      });
    for (const f of o.findings) {
      const [prev] = await db
        .select({ consecutive: patterns.consecutiveWeeks })
        .from(patterns)
        .where(and(eq(patterns.profileId, profileId), eq(patterns.isoWeek, prevWeek), eq(patterns.detectorKey, o.key), eq(patterns.subject, f.subject)))
        .orderBy(desc(patterns.updatedAt))
        .limit(1);
      const values = {
        profileId,
        isoWeek: week,
        detectorKey: o.key,
        subject: f.subject,
        title: f.title,
        statement: f.statement,
        confidence: f.confidence,
        sampleSize: f.sampleSize,
        effectSize: f.effectSize === null ? null : String(f.effectSize),
        statBasis: f.statBasis,
        evidenceDealIds: f.evidenceDealIds,
        evidenceEventIds: f.evidenceEventIds,
        consecutiveWeeks: (prev?.consecutive ?? 0) + 1,
        runId,
      };
      await db
        .insert(patterns)
        .values(values)
        .onConflictDoUpdate({
          target: [patterns.profileId, patterns.isoWeek, patterns.detectorKey, patterns.subject],
          set: { ...values, updatedAt: new Date() },
        });
    }
  }
}

export async function runDetect(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const stage = await startStage(opts.runId, "detect");
  try {
    const r = await detectAll({ runId: opts.runId });
    const summary: Record<string, unknown> = { target_week: r.targetWeek, history_weeks: r.historyWeeks };
    let fired = 0;
    for (const [p, outcomes] of Object.entries(r.byProfile)) {
      summary[p] = Object.fromEntries(outcomes.map((o) => [o.key, `${o.status}${o.findings.length ? `:${o.findings.length}` : ""}`]));
      fired += outcomes.reduce((s, o) => s + o.findings.length, 0);
    }
    stage.counters.itemsOut = fired;
    await stage.finish("ok", summary);
    return { processed: Object.keys(r.byProfile).length, next_cursor: null };
  } catch (err) {
    await stage.finish("error", undefined, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
