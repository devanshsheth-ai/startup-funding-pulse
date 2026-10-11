import { connection, type NextRequest } from "next/server";
import { getAggregates } from "@/db/queries/aggregates";
import { logger } from "@/lib/logger";
import { resolveProfile, resolveWindow } from "@/lib/view";

/** GET /api/aggregates?profile=&from=&to= — the SQL Aggregates object (PRD §12, §22). Defaults to the profile's digest window. */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const sp = req.nextUrl.searchParams;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  try {
    const { active } = await resolveProfile(sp.get("profile"));
    const def = resolveWindow("digest", active, new Date());
    const from = iso.test(sp.get("from") ?? "") ? (sp.get("from") as string) : def.start;
    const to = iso.test(sp.get("to") ?? "") ? (sp.get("to") as string) : def.end;
    if (from > to) return Response.json({ ok: false, error: "from must be ≤ to" }, { status: 400 });
    return Response.json({ ok: true, profile: active?.id ?? null, aggregates: await getAggregates({ start: from, end: to }) });
  } catch (err) {
    logger.error("api aggregates failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
