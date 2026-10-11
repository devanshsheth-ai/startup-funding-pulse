import { after, connection, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { isCronAuthorized, unauthorized } from "@/lib/auth";
import { logger, newRunId } from "@/lib/logger";
import { dispatch, STAGES, type DispatchPosition } from "@/pipeline/dispatch";

/**
 * GET /api/cron/dispatch — the single daily cron entry (PRD §21.1).
 *
 * Responds 202 immediately and runs the stage chain in `after()`. If the
 * invocation budget runs out, it calls itself with the saved position, so no
 * invocation approaches the function timeout. `?sync=1` runs inline and
 * returns the result (manual trigger / debugging).
 */

// Narration can take ~45 s; Hobby allows 300 s. Chunked stages keep their own 50 s budget (D-062).
export const maxDuration = 300;

const querySchema = z.object({
  run_id: z.string().regex(/^run_[0-9A-Za-z_]+$/).optional(),
  stage: z.coerce.number().int().min(0).optional(),
  cursor: z.string().max(200).optional(),
  hop: z.coerce.number().int().min(0).max(50).default(0),
  sync: z.enum(["1", "true"]).optional(),
});

const MAX_HOPS = 50;

function continuationUrl(req: NextRequest, runId: string, next: DispatchPosition, hop: number): string {
  const origin = getEnv().NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const u = new URL("/api/cron/dispatch", origin);
  u.searchParams.set("run_id", runId);
  u.searchParams.set("stage", String(next.stageIndex));
  if (next.cursor) u.searchParams.set("cursor", next.cursor);
  u.searchParams.set("hop", String(hop + 1));
  return u.toString();
}

export async function GET(req: NextRequest): Promise<Response> {
  await connection();
  if (!isCronAuthorized(req)) return unauthorized();

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid query" }, { status: 400 });
  const q = parsed.data;

  const runId = q.run_id ?? newRunId();
  const from: DispatchPosition = { stageIndex: Math.min(q.stage ?? 0, STAGES.length), cursor: q.cursor ?? null };
  const log = logger.child({ run_id: runId, stage: "dispatch", hop: q.hop });

  if (q.sync) {
    const result = await dispatch(runId, from);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  }

  const authorization = req.headers.get("authorization") ?? "";
  after(async () => {
    try {
      const result = await dispatch(runId, from);
      if (!result.done && result.next) {
        if (q.hop + 1 >= MAX_HOPS) {
          log.error("continuation limit reached; run left incomplete", { next: result.next });
          return;
        }
        // The next hop answers 202 at once, so this await is short.
        await fetch(continuationUrl(req, runId, result.next, q.hop), {
          headers: { authorization },
          signal: AbortSignal.timeout(10_000),
        });
        log.info("continuation scheduled", { next: result.next });
      }
    } catch (err) {
      log.error("dispatch failed", { error: err instanceof Error ? err : String(err) });
    }
  });

  return Response.json({ ok: true, accepted: true, run_id: runId, from }, { status: 202 });
}
