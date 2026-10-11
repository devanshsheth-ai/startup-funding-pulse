import { connection, type NextRequest } from "next/server";
import { queryEvents } from "@/db/queries/deals";
import { parseEventFilters } from "@/lib/deal-filters";
import { logger } from "@/lib/logger";

/** GET /api/events?type=&from=&to=&sector=&q=&limit=&cursor= — public (PRD §22). */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const f = parseEventFilters(req.nextUrl.searchParams);
  try {
    const res = await queryEvents(f);
    return Response.json({ ok: true, n: res.total, filters: f, next_cursor: res.nextCursor, events: res.rows });
  } catch (err) {
    logger.error("api events failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
