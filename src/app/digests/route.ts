import { connection, type NextRequest } from "next/server";

/** /digests — the archive now lives on the Brief page (brief history picker). Kept so old links work. */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const profile = req.nextUrl.searchParams.get("profile");
  const target = new URL("/brief", req.nextUrl.origin);
  if (profile && /^[a-z0-9-]+$/.test(profile)) target.searchParams.set("profile", profile);
  return Response.redirect(target, 308);
}
