import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { digests } from "@/db/schema";
import { renderDigest } from "@/emails/render";
import type { DigestContent } from "@/pipeline/digest";

/** GET /share/[token] — public read-only render of a stored digest (PRD §18.10). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  await connection();
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const [row] = await getDb().select({ content: digests.content }).from(digests).where(eq(digests.shareToken, token)).limit(1);
  if (!row?.content) return new Response("This digest link is invalid or has expired.", { status: 404 });
  const { html } = await renderDigest(row.content as DigestContent);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
