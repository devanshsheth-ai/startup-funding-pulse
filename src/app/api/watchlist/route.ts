import { and, eq, sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { portfolio, profiles, watchlist } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { watchUpsertSchema } from "@/lib/settings-schemas";
import { normalizeCompanyName, watchKey } from "@/pipeline/normalize";

/**
 * POST /api/watchlist — add or edit watchlist entries (single, bulk paste or
 * CSV import). Upserts on (profile, type, normalised value); an entry that was
 * removed earlier is restored. A company already tracked in the portfolio is
 * rejected: portfolio and watchlist must not overlap (PRD §8.1).
 */
export async function POST(req: NextRequest): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const parsed = watchUpsertSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  const { profile, items } = parsed.data;
  const db = getDb();
  try {
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profile)).limit(1);
    if (!p) return Response.json({ ok: false, error: "unknown profile" }, { status: 404 });
    const held = new Set((await db.select({ name: portfolio.name }).from(portfolio).where(and(eq(portfolio.profileId, profile), eq(portfolio.isActive, true)))).map((r) => normalizeCompanyName(r.name)));
    const rejected: { value: string; reason: string }[] = [];
    let saved = 0;
    for (const it of items) {
      if (it.watch_type === "company" && held.has(normalizeCompanyName(it.value))) {
        rejected.push({ value: it.value, reason: "already a tracked portfolio company" });
        continue;
      }
      const values = {
        profileId: profile,
        watchType: it.watch_type,
        value: it.value,
        normalizedValue: watchKey(it.watch_type, it.value),
        aliases: it.aliases,
        notes: it.notes,
        tags: it.tags,
        alertsEnabled: it.alerts_enabled,
        status: it.status,
        updatedAt: new Date(),
      };
      if (it.id) {
        const r = await db.update(watchlist).set(values).where(and(eq(watchlist.id, it.id), eq(watchlist.profileId, profile))).returning({ id: watchlist.id });
        if (r.length) saved++;
        else rejected.push({ value: it.value, reason: "entry not found" });
        continue;
      }
      await db
        .insert(watchlist)
        .values(values)
        .onConflictDoUpdate({
          target: [watchlist.profileId, watchlist.watchType, watchlist.normalizedValue],
          set: { value: sql`excluded.value`, aliases: sql`excluded.aliases`, notes: sql`excluded.notes`, tags: sql`excluded.tags`, alertsEnabled: sql`excluded.alerts_enabled`, status: sql`excluded.status`, updatedAt: new Date() },
        });
      saved++;
    }
    return Response.json({ ok: true, saved, rejected });
  } catch (err) {
    logger.error("watchlist upsert failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}
