import { connection, type NextRequest } from "next/server";
import { getMarketMap, getSectorSummary } from "@/db/queries/sectors";
import { logger } from "@/lib/logger";
import { SECTORS } from "@/lib/taxonomy";
import { toIsoDate } from "@/pipeline/normalize";

/** GET /api/sectors/:sector?from=&to=&profile= — sector statistics and the latest market map (PRD §22). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ sector: string }> }): Promise<Response> {
  await connection();
  const sector = decodeURIComponent((await ctx.params).sector);
  if (!SECTORS.includes(sector)) return Response.json({ ok: false, error: "unknown sector" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const to = iso.test(sp.get("to") ?? "") ? (sp.get("to") as string) : toIsoDate(now);
  const from = iso.test(sp.get("from") ?? "") ? (sp.get("from") as string) : toIsoDate(new Date(now.getTime() - 83 * 86_400_000));
  const profile = sp.get("profile");
  try {
    const [summary, map] = await Promise.all([getSectorSummary(sector, from, to), getMarketMap(sector, profile && /^[a-z0-9-]+$/.test(profile) ? profile : null)]);
    return Response.json({ ok: true, ...summary, market_map: map });
  } catch (err) {
    logger.error("api sector failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
