import { connection, type NextRequest } from "next/server";
import { getDeal } from "@/db/queries/deals";
import { logger } from "@/lib/logger";

/** GET /api/deals/:id?profile= — one deal with sources, investors and (per profile) its scorecard. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{16,64}$/.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const profile = req.nextUrl.searchParams.get("profile");
  try {
    const deal = await getDeal(id, profile && /^[a-z0-9-]+$/.test(profile) ? profile : null);
    if (!deal) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, deal });
  } catch (err) {
    logger.error("api deal failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
