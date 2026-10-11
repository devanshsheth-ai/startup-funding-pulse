import { connection, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { SECTORS } from "@/lib/taxonomy";
import { generateDeepDive } from "@/pipeline/deep-dive";

/**
 * POST /api/sectors/:sector/deep-dive?profile= — generates the sector
 * deep-dive (PRD §18.6). Read-only with respect to product data (it writes
 * nothing but the Gemini response cache), so no secret is required (D-065).
 */
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ sector: string }> }): Promise<Response> {
  await connection();
  const sector = decodeURIComponent((await ctx.params).sector);
  const profile = req.nextUrl.searchParams.get("profile") ?? "aarav-familyoffice";
  if (!SECTORS.includes(sector) || !/^[a-z0-9-]+$/.test(profile)) return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  try {
    const dd = await generateDeepDive(sector, profile);
    return Response.json(dd, { status: dd.ok ? 200 : dd.error === "unknown profile" ? 404 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("deep dive failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "The deep-dive is unavailable right now." }, { status: 503 });
  }
}
