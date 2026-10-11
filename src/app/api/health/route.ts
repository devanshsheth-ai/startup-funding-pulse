import { connection } from "next/server";
import { getArticleTotals, getLastSuccessfulCollect, getPipelineFunnel, getRunLogTail, getSourceHealth } from "@/db/queries/ingestion";
import { getProvenance } from "@/db/queries/methodology";
import { logger } from "@/lib/logger";

/** GET /api/health — machine-readable version of /health (PRD §22): liveness, funnel, sources, run log. */
export async function GET(): Promise<Response> {
  await connection();
  try {
    const [lastCollect, funnel, totals, sources, runs, prov] = await Promise.all([getLastSuccessfulCollect(), getPipelineFunnel(), getArticleTotals(), getSourceHealth(), getRunLogTail(20), getProvenance()]);
    const live24h = lastCollect !== null && Date.now() - lastCollect.getTime() < 24 * 3_600_000;
    return Response.json(
      { ok: true, live_within_24h: live24h, last_successful_collect: lastCollect, funnel, articles: totals, provenance: prov, sources, run_log: runs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    logger.error("api health failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
