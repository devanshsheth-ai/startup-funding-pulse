import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { renderDigest } from "@/emails/render";
import { logger, newRunId } from "@/lib/logger";
import { buildDigest, loadProfileWithName } from "@/pipeline/digest";

/**
 * GET /api/digest/preview?profile=&mode=weekly|daily — renders the digest
 * template for the current window WITHOUT sending or saving it (PRD §16.3).
 */
// Narration can take ~45 s; Hobby allows 300 s. Chunked stages keep their own 50 s budget (D-062).
export const maxDuration = 300;

const query = z.object({ profile: z.string().regex(/^[a-z0-9-]+$/).default("aarav-familyoffice"), mode: z.enum(["weekly", "daily"]).default("weekly"), format: z.enum(["html", "text", "json"]).default("html") });

export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return Response.json({ ok: false, error: "invalid query" }, { status: 400 });
  try {
    const profile = await loadProfileWithName(q.data.profile);
    if (!profile) return Response.json({ ok: false, error: "unknown profile" }, { status: 404 });
    const content = await buildDigest(profile, q.data.mode, new Date());
    if (q.data.format === "json") return Response.json(content, { headers: { "Cache-Control": "no-store" } });
    const { html, text } = await renderDigest(content);
    return q.data.format === "text"
      ? new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
      : new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("digest preview failed", { run_id: newRunId(), error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "Preview unavailable right now." }, { status: 503 });
  }
}
