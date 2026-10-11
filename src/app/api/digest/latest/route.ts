import { and, desc, eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";

/** GET /api/digest/latest?profile=&mode= — the most recent stored digest (JSON). */
const query = z.object({ profile: z.string().regex(/^[a-z0-9-]+$/).default("aarav-familyoffice"), mode: z.enum(["weekly", "daily"]).default("weekly") });

export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return Response.json({ ok: false, error: "invalid query" }, { status: 400 });
  const [row] = await getDb()
    .select({ id: digests.id, headline: digests.headline, windowStart: digests.windowStart, windowEnd: digests.windowEnd, emailStatus: digests.emailStatus, emailSentAt: digests.emailSentAt, shareToken: digests.shareToken, content: digests.content })
    .from(digests)
    .where(and(eq(digests.profileId, q.data.profile), eq(digests.mode, q.data.mode)))
    .orderBy(desc(digests.generatedAt))
    .limit(1);
  if (!row) return Response.json({ ok: false, error: "no digest yet" }, { status: 404 });
  return Response.json({ ok: true, ...row }, { headers: { "Cache-Control": "no-store" } });
}
