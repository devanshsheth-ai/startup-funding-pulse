import { connection, type NextRequest } from "next/server";

/**
 * GET /brief/latest?profile= — kept for old links; the brief now lives inside
 * the app at /brief, which always shows the latest stored brief (and falls
 * back to the last good one), so this simply forwards there.
 */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const profile = req.nextUrl.searchParams.get("profile");
  const target = new URL("/brief", req.nextUrl.origin);
  if (profile && /^[a-z0-9-]+$/.test(profile)) target.searchParams.set("profile", profile);
  return Response.redirect(target, 307);
}
