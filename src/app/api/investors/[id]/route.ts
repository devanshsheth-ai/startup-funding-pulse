import { connection } from "next/server";
import { getInvestorProfile } from "@/db/queries/investors";
import { logger } from "@/lib/logger";

/** GET /api/investors/:id — investor profile statistics (PRD §22). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const inv = await getInvestorProfile(Number(id));
    if (!inv) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, investor: inv });
  } catch (err) {
    logger.error("api investor failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
