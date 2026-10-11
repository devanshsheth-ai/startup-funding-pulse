import { and, desc, eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { detectorRuns, patterns } from "@/db/schema";
import { logger } from "@/lib/logger";
import { resolveProfile } from "@/lib/view";

/** GET /api/patterns?profile=&week=YYYY-Www — fired patterns plus every detector's status for that week (PRD §22). */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const sp = req.nextUrl.searchParams;
  try {
    const { active } = await resolveProfile(sp.get("profile"));
    if (!active) return Response.json({ ok: false, error: "unknown profile" }, { status: 404 });
    const db = getDb();
    let week = sp.get("week");
    if (!week || !/^\d{4}-W\d{2}$/.test(week)) {
      const [latest] = await db.select({ w: detectorRuns.isoWeek }).from(detectorRuns).where(eq(detectorRuns.profileId, active.id)).orderBy(desc(detectorRuns.isoWeek)).limit(1);
      week = latest?.w ?? null;
    }
    if (!week) return Response.json({ ok: true, profile: active.id, week: null, patterns: [], detectors: [] });
    const [pats, runs] = await Promise.all([
      db.select().from(patterns).where(and(eq(patterns.profileId, active.id), eq(patterns.isoWeek, week))),
      db.select({ key: detectorRuns.detectorKey, status: detectorRuns.status, reason: detectorRuns.reason, gates: detectorRuns.gates, findings: detectorRuns.findings }).from(detectorRuns).where(and(eq(detectorRuns.profileId, active.id), eq(detectorRuns.isoWeek, week))),
    ]);
    return Response.json({ ok: true, profile: active.id, week, n: pats.length, patterns: pats, detectors: runs });
  } catch (err) {
    logger.error("api patterns failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
