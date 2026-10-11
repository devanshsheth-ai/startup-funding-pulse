import { eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { watchlist } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger } from "@/lib/logger";

/** DELETE /api/watchlist/:id — soft delete (status = removed, alerts off); re-adding restores it (CLAUDE.md §2). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const r = await getDb().update(watchlist).set({ status: "removed", alertsEnabled: false, updatedAt: new Date() }).where(eq(watchlist.id, Number(id))).returning({ id: watchlist.id });
    if (r.length === 0) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, id: Number(id), status: "removed" });
  } catch (err) {
    logger.error("watchlist delete failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "delete failed" }, { status: 500 });
  }
}
