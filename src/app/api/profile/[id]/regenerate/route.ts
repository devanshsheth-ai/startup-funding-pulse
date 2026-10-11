import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { isAdminAuthorized, unauthorized } from "@/lib/auth";
import { logger, newRunId } from "@/lib/logger";
import { generateAndMaybeSend } from "@/pipeline/deliver";
import { rescoreProfile } from "@/pipeline/score";

/**
 * POST /api/profile/:id/regenerate?mode=weekly|daily — the dashboard's
 * Regenerate button (PRD §18.1): rescore this profile against its current
 * mandate, then build and store a fresh brief without emailing it.
 */
export const maxDuration = 300;

const params = z.object({ id: z.string().regex(/^[a-z0-9-]+$/) });
const query = z.object({ mode: z.enum(["weekly", "daily"]).default("weekly") });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!isAdminAuthorized(req)) return unauthorized();
  const p = params.safeParse(await ctx.params);
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success || !q.success) return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const runId = newRunId();
  try {
    // Leave ~100 s of the 300 s limit for narration.
    const score = await rescoreProfile(p.data.id, { runId, deadline: Date.now() + 180_000 });
    if (!score.ok) return Response.json({ ok: false, stage: "score", error: score.reason }, { status: score.reason === "unknown profile" ? 404 : 503 });
    const digest = await generateAndMaybeSend(p.data.id, q.data.mode, { send: false, runId });
    return Response.json({ ok: digest.digestId !== null, scored: score.scored, digestId: digest.digestId, shareUrl: digest.shareUrl, status: digest.status, reason: digest.reason });
  } catch (err) {
    logger.error("regenerate failed", { run_id: runId, error: err instanceof Error ? err : String(err) });
    return Response.json({ ok: false, error: "Regenerate failed; see /health run log." }, { status: 500 });
  }
}
