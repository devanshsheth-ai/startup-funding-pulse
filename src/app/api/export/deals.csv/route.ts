import { connection, type NextRequest } from "next/server";
import { DEALS_CSV_HEADER, dealCsvRow, queryDeals } from "@/db/queries/deals";
import { parseDealFilters } from "@/lib/deal-filters";
import { toCsv } from "@/lib/format";
import { logger } from "@/lib/logger";

/**
 * GET /api/export/deals.csv?<same filters as /api/deals> — the current
 * filtered view as CSV with every field PRD §23 lists. Pagination params are
 * ignored: the export is the whole filtered set (capped at 5,000 rows).
 */
export const maxDuration = 60;
const CAP = 5_000;

export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const base = parseDealFilters(req.nextUrl.searchParams);
  try {
    const rows: unknown[][] = [];
    let cursor: number | null = 0;
    while (cursor !== null && rows.length < CAP) {
      const page = await queryDeals({ ...base, limit: 500, cursor });
      rows.push(...page.rows.map(dealCsvRow));
      cursor = page.nextCursor;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(DEALS_CSV_HEADER, rows.slice(0, CAP)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="funding-pulse-deals-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("csv export failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
