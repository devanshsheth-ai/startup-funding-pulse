import { type NextRequest } from "next/server";
import { z } from "zod";
import { PIPELINE } from "@/config/pipeline";
import { isCronAuthorized, unauthorized } from "@/lib/auth";
import { newRunId } from "@/lib/logger";
import { runCollect } from "@/pipeline/ingest/collect";

/**
 * POST /api/cron/collect?cursor=&limit= — manual, chunked collection trigger
 * (PRD §21.2–21.3). Returns `{ processed, next_cursor }`.
 */

export const maxDuration = 60;

const querySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  run_id: z.string().regex(/^run_[0-9A-Za-z_]+$/).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ ok: false, error: "invalid query" }, { status: 400 });

  const runId = parsed.data.run_id ?? newRunId();
  const result = await runCollect({
    runId,
    cursor: parsed.data.cursor ?? null,
    limit: parsed.data.limit,
    deadline: Date.now() + PIPELINE.invocationBudgetMs,
  });
  return Response.json({ ok: true, run_id: runId, ...result }, { headers: { "Cache-Control": "no-store" } });
}
