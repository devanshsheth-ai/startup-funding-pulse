import { eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { portfolio } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger } from "@/lib/logger";

/** DELETE /api/portfolio/:id — soft delete (is_active = false); its adjacency edges stop surfacing. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const r = await getDb().update(portfolio).set({ isActive: false, updatedAt: new Date() }).where(eq(portfolio.id, Number(id))).returning({ id: portfolio.id });
    if (r.length === 0) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, id: Number(id), isActive: false });
  } catch (err) {
    logger.error("portfolio delete failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "delete failed" }, { status: 500 });
  }
}
