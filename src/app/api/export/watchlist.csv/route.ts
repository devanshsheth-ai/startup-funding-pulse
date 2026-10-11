import { connection, type NextRequest } from "next/server";
import { getWatchlist } from "@/db/queries/portfolio";
import { toCsv } from "@/lib/format";
import { logger } from "@/lib/logger";
import { WATCHLIST_CSV_HEADER } from "@/lib/settings-schemas";

/** GET /api/export/watchlist.csv?profile= — round-trip compatible with the settings CSV importer (PRD §23). */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const profile = req.nextUrl.searchParams.get("profile") ?? "";
  if (!/^[a-z0-9-]+$/.test(profile)) return Response.json({ ok: false, error: "profile required" }, { status: 400 });
  try {
    const rows = await getWatchlist(profile);
    const csv = toCsv([...WATCHLIST_CSV_HEADER], rows.map((w) => [w.type, w.value, w.aliases, w.notes, w.tags, w.alertsEnabled, w.status]));
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="watchlist-${profile}.csv"`, "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("watchlist export failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
