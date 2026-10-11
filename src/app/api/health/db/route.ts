import { connection } from "next/server";
import { probeDatabase } from "@/db/queries/health";
import { logger, newRunId } from "@/lib/logger";

/**
 * GET /api/health/db — M0 acceptance probe: SELECT 1 and a pgvector round trip.
 * Public and read-only. Errors are logged server-side; the response never
 * carries a stack trace or connection details.
 */
export async function GET(): Promise<Response> {
  await connection(); // request-time only; never run during build prerendering
  const runId = newRunId();
  const log = logger.child({ run_id: runId, stage: "health_db" });
  try {
    const result = await probeDatabase();
    const ok = result.selectOne.ok && result.vector.ok;
    log.info("db probe complete", { ok, latency_ms: result.selectOne.latencyMs });
    return Response.json(
      { ok, run_id: runId, checked_at: new Date().toISOString(), ...result },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("db probe failed", { error: err instanceof Error ? err : String(err) });
    return Response.json(
      { ok: false, run_id: runId, error: "Database probe failed. See server logs for this run_id." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
