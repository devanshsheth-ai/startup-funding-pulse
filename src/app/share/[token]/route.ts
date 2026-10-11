import { eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";
import { renderDigest } from "@/emails/render";
import type { DigestContent } from "@/pipeline/digest";

/**
 * GET /share/[token] — public read-only render of a stored digest (PRD §18.10).
 * `?print=1` opens the browser's print dialog for "Save as PDF" (PRD §23).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  await connection();
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const [row] = await getDb().select({ content: digests.content }).from(digests).where(eq(digests.shareToken, token)).limit(1);
  if (!row?.content) return new Response("This digest link is invalid or has expired.", { status: 404 });
  let { html } = await renderDigest(row.content as DigestContent);
  if (req.nextUrl.searchParams.get("print") === "1") {
    const script = `<style>@page{margin:12mm}</style><script>addEventListener("load",function(){setTimeout(function(){print()},300)})</script>`;
    html = html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
  }
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
