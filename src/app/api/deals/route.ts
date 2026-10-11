import { connection, type NextRequest } from "next/server";
import { queryDeals } from "@/db/queries/deals";
import { parseDealFilters } from "@/lib/deal-filters";
import { logger } from "@/lib/logger";

/**
 * GET /api/deals?profile=&from=&to=&sector=&stage=&investor=&city=&min_amount=&tier=&limit=&cursor=
 * Public read endpoint (PRD §22). Filters are whitelisted and validated.
 */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const f = parseDealFilters(req.nextUrl.searchParams);
  try {
    const res = await queryDeals(f);
    return Response.json({ ok: true, n: res.total, filters: f, next_cursor: res.nextCursor, deals: res.rows });
  } catch (err) {
    logger.error("api deals failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
