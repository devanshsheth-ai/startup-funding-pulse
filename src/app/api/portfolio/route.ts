import { and, eq, ne, sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { portfolio, profiles, watchlist } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { portfolioInputSchema } from "@/lib/settings-schemas";
import { normalizeCompanyName } from "@/pipeline/normalize";

/**
 * POST /api/portfolio — add or edit a tracked (simulated) portfolio company
 * (PRD §18.8, §22). relationship_type is always simulated_holding. When the
 * description or keywords change, the embedding is cleared so the next
 * scoring run re-embeds it and re-runs the adjacency shortlist.
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
  const parsed = portfolioInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  const v = parsed.data;
  const db = getDb();
  try {
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, v.profile)).limit(1);
    if (!p) return Response.json({ ok: false, error: "unknown profile" }, { status: 404 });
    const clash = await db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(and(eq(watchlist.profileId, v.profile), eq(watchlist.watchType, "company"), eq(watchlist.normalizedValue, normalizeCompanyName(v.name)), ne(watchlist.status, "removed")))
      .limit(1);
    if (clash.length) return Response.json({ ok: false, error: `${v.name} is on the watchlist; remove it there first (portfolio and watchlist must not overlap).` }, { status: 409 });

    const fields = { name: v.name, description: v.description, sector: v.sector, subSector: v.sub_sector, stageHeld: v.stage_held, city: v.city, adjacencyKeywords: v.adjacency_keywords, isActive: true, updatedAt: new Date() };
    if (v.id) {
      const [cur] = await db.select({ description: portfolio.description, keywords: portfolio.adjacencyKeywords }).from(portfolio).where(and(eq(portfolio.id, v.id), eq(portfolio.profileId, v.profile))).limit(1);
      if (!cur) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      const changed = cur.description !== v.description || cur.keywords.join("|") !== v.adjacency_keywords.join("|");
      await db.update(portfolio).set(changed ? { ...fields, embedding: null } : fields).where(eq(portfolio.id, v.id));
      return Response.json({ ok: true, id: v.id, reembed: changed });
    }
    const [row] = await db
      .insert(portfolio)
      .values({ profileId: v.profile, relationshipType: "simulated_holding", ...fields })
      .onConflictDoUpdate({ target: [portfolio.profileId, portfolio.name], set: { ...fields, embedding: sql`NULL` } })
      .returning({ id: portfolio.id });
    return Response.json({ ok: true, id: row?.id ?? null, reembed: true });
  } catch (err) {
    logger.error("portfolio save failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "save failed" }, { status: 500 });
  }
}
