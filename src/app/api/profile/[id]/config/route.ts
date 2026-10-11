import { eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { mandateConfigSchema } from "@/config/profile";
import { getDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * POST /api/profile/:id/config — replace a profile's mandate config (PRD §18.8, §22).
 * The full object is validated with the same schema the seed uses, so scoring
 * never runs on a malformed mandate. Rescoring happens on Regenerate or nightly.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(id)) return Response.json({ ok: false, error: "invalid profile" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const parsed = mandateConfigSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: "invalid config", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
  try {
    const res = await getDb().update(profiles).set({ config: parsed.data, updatedAt: new Date() }).where(eq(profiles.id, id)).returning({ id: profiles.id });
    if (res.length === 0) return Response.json({ ok: false, error: "unknown profile" }, { status: 404 });
    logger.info("mandate config updated", { profile: id });
    return Response.json({ ok: true, profile: id });
  } catch (err) {
    logger.error("config update failed", { error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "update failed" }, { status: 500 });
  }
}
