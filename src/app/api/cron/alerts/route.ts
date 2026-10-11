import { connection, type NextRequest } from "next/server";
import { isCronAuthorized, unauthorized } from "@/lib/auth";
import { newRunId } from "@/lib/logger";
import { runAlerts } from "@/pipeline/alerts/engine";

/**
 * GET|POST /api/cron/alerts — the second daily cron (02:00 UTC = 07:30 IST, after
 * default quiet hours end): releases queued alerts and evaluates new ones (D-071).
 * `?send=0` evaluates and logs without emailing.
 */
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<Response> {
  await connection();
  if (!isCronAuthorized(req)) return unauthorized();
  const send = req.nextUrl.searchParams.get("send") === "0" ? false : undefined;
  const runId = newRunId();
  const res = await runAlerts({ runId, cursor: null, deadline: Date.now() + 100_000, send });
  return Response.json({ ok: true, run_id: runId, ...res }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
