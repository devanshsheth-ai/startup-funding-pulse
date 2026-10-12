import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { digests, profiles } from "@/db/schema";
import { logger } from "@/lib/logger";

/** GET /api/digest/:id — a stored digest's full content as JSON (PRD §22). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const [row] = await getDb()
      .select({ id: digests.id, profileId: digests.profileId, mode: digests.mode, generatedAt: digests.generatedAt, emailStatus: digests.emailStatus, content: digests.content, rejected: digests.rejected })
      .from(digests)
      .innerJoin(profiles, eq(profiles.id, digests.profileId))
      .where(and(eq(digests.id, Number(id)), eq(profiles.isActive, true)))
      .limit(1);
    if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, ...row });
  } catch (err) {
    logger.error("api digest failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
