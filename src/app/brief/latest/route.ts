import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";

/**
 * GET /brief/latest?profile= — the last good digest, always servable (PRD §27):
 * prefers the latest emailed brief, falls back to the latest generated one,
 * and redirects to its read-only share page. Works even when today's
 * pipeline or aggregates are failing, because it only reads stored content.
 */
export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const profile = req.nextUrl.searchParams.get("profile");
  const filter = profile && /^[a-z0-9-]+$/.test(profile) ? eq(digests.profileId, profile) : sql`TRUE`;
  try {
    const [row] = await getDb()
      .select({ token: digests.shareToken })
      .from(digests)
      .where(and(filter, isNotNull(digests.content), isNotNull(digests.shareToken)))
      .orderBy(sql`(${digests.emailStatus} = 'sent') DESC NULLS LAST`, desc(digests.generatedAt))
      .limit(1);
    if (!row?.token) return new Response("No brief has been generated yet.", { status: 404 });
    return Response.redirect(new URL(`/share/${row.token}`, req.nextUrl.origin), 307);
  } catch {
    return new Response("The brief archive is temporarily unreachable. Please try again shortly.", { status: 503 });
  }
}
