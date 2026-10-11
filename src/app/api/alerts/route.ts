import { connection, type NextRequest } from "next/server";
import { getAlertInbox } from "@/db/queries/alerts";
import { logger } from "@/lib/logger";

/** GET /api/alerts?profile=&status= — the full alert log (sent, queued, batched, suppressed) with reasons. */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const sp = req.nextUrl.searchParams;
  const profile = sp.get("profile") ?? "aarav-familyoffice";
  const status = sp.get("status");
  if (!/^[a-z0-9-]+$/.test(profile)) return Response.json({ ok: false, error: "invalid profile" }, { status: 400 });
  try {
    const rows = await getAlertInbox(profile, status && /^[a-z]+$/.test(status) ? status : null, 200);
    return Response.json({ ok: true, profile, n: rows.length, alerts: rows });
  } catch (err) {
    logger.error("api alerts failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
