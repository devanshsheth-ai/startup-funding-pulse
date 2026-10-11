import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { isCronAuthorized, unauthorized } from "@/lib/auth";
import { newRunId } from "@/lib/logger";
import { generateAndMaybeSend } from "@/pipeline/deliver";

/** POST /api/cron/digest?profile=&mode=&send=1 — generate (and send) a digest now (PRD §21.2). */
// Narration can take ~45 s; Hobby allows 300 s. Chunked stages keep their own 50 s budget (D-062).
export const maxDuration = 300;

const query = z.object({ profile: z.string().regex(/^[a-z0-9-]+$/), mode: z.enum(["weekly", "daily"]).default("weekly"), send: z.enum(["0", "1"]).default("0") });

export async function POST(req: NextRequest): Promise<Response> {
  await connection();
  if (!isCronAuthorized(req)) return unauthorized();
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return Response.json({ ok: false, error: "invalid query" }, { status: 400 });
  const outcome = await generateAndMaybeSend(q.data.profile, q.data.mode, { send: q.data.send === "1", runId: newRunId() });
  return Response.json({ ok: outcome.status !== "failed", ...outcome }, { status: outcome.status === "failed" ? 502 : 200 });
}
