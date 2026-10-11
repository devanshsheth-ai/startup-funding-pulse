import { and, desc, eq, gte, sql } from "drizzle-orm";
import { mandateConfigSchema, type MandateConfig } from "@/config/profile";
import { getDb } from "@/db/client";
import { companies, dealSources, deals, detectorRuns, profiles, relevanceScores, sources } from "@/db/schema";
import type { Scorecard } from "@/pipeline/rubric";
import { digestWindow } from "@/pipeline/score";

/** Read models for /methodology: live config, a real worked example, provenance. */

export interface ProfileSummary {
  id: string;
  displayName: string;
  isDefault: boolean;
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  return getDb().select({ id: profiles.id, displayName: profiles.displayName, isDefault: profiles.isDefault }).from(profiles).orderBy(desc(profiles.isDefault), profiles.id);
}

export async function getProfileConfig(id: string | null): Promise<{ id: string; displayName: string; config: MandateConfig; window: { start: string; end: string } } | null> {
  const db = getDb();
  const [row] = id
    ? await db.select().from(profiles).where(eq(profiles.id, id)).limit(1)
    : await db.select().from(profiles).where(eq(profiles.isDefault, true)).limit(1);
  if (!row) return null;
  return { id: row.id, displayName: row.displayName, config: mandateConfigSchema.parse(row.config), window: digestWindow(row.lastDigestSentAt, new Date()) };
}

export interface WorkedExample {
  company: string;
  stage: string;
  amountUsd: number | null;
  sector: string;
  announced: string;
  sourceUrl: string | null;
  publication: string | null;
  card: Scorecard;
}

/** The highest-scoring non-excluded deal in the profile's current window (or latest). */
export async function getWorkedExample(profileId: string, windowStart: string): Promise<WorkedExample | null> {
  const db = getDb();
  const pick = async (inWindow: boolean) =>
    db
      .select({
        company: companies.canonicalName,
        stage: deals.roundStage,
        amountUsd: deals.amountUsd,
        sector: deals.sectorPrimary,
        announced: deals.announcedDate,
        breakdown: relevanceScores.breakdown,
        sourceUrl: dealSources.url,
        publication: dealSources.publication,
      })
      .from(relevanceScores)
      .innerJoin(deals, eq(deals.id, relevanceScores.dealId))
      .innerJoin(companies, eq(companies.id, deals.companyId))
      .leftJoin(dealSources, and(eq(dealSources.dealId, deals.id), eq(dealSources.isPrimary, true)))
      .where(and(eq(relevanceScores.profileId, profileId), sql`${relevanceScores.tier} <> 'archive'`, inWindow ? gte(deals.announcedDate, windowStart) : sql`TRUE`))
      .orderBy(desc(relevanceScores.score), desc(deals.announcedDate))
      .limit(1);
  const [row] = (await pick(true)).length ? await pick(true) : await pick(false);
  if (!row) return null;
  return {
    company: row.company,
    stage: row.stage,
    amountUsd: row.amountUsd === null ? null : Number(row.amountUsd),
    sector: row.sector,
    announced: row.announced,
    sourceUrl: row.sourceUrl,
    publication: row.publication,
    card: row.breakdown as Scorecard,
  };
}

export async function getProvenance() {
  const db = getDb();
  const [src] = await db
    .select({
      live: sql<number>`count(*) filter (where ${sources.enabled})::int`,
      backfill: sql<number>`count(*) filter (where ${sources.lastStatus} = 'backfill_only')::int`,
      disabled: sql<number>`count(*) filter (where not ${sources.enabled} and coalesce(${sources.lastStatus}, '') <> 'backfill_only')::int`,
    })
    .from(sources);
  const modes = await db.select({ mode: deals.ingestionMode, n: sql<number>`count(*)::int` }).from(deals).groupBy(deals.ingestionMode);
  const [scored] = await db.select({ n: sql<number>`count(*)::int`, profiles: sql<number>`count(distinct ${relevanceScores.profileId})::int` }).from(relevanceScores);
  return { sources: src ?? { live: 0, backfill: 0, disabled: 0 }, modes, scored: scored ?? { n: 0, profiles: 0 } };
}

export interface DetectorRow {
  key: string;
  status: string;
  reason: string;
  findings: number;
  isoWeek: string;
}

/** Latest detector outcomes for a profile (one row per detector, most recent week). */
export async function getDetectorStatus(profileId: string): Promise<{ week: string | null; rows: DetectorRow[] }> {
  const db = getDb();
  const [latest] = await db
    .select({ week: sql<string | null>`max(${detectorRuns.isoWeek})` })
    .from(detectorRuns)
    .where(eq(detectorRuns.profileId, profileId));
  if (!latest?.week) return { week: null, rows: [] };
  const rows = await db
    .select({ key: detectorRuns.detectorKey, status: detectorRuns.status, reason: detectorRuns.reason, findings: detectorRuns.findings, isoWeek: detectorRuns.isoWeek })
    .from(detectorRuns)
    .where(and(eq(detectorRuns.profileId, profileId), eq(detectorRuns.isoWeek, latest.week)));
  return { week: latest.week, rows };
}
