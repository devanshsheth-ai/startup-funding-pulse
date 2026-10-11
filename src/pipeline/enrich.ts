import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, EMBEDDING_DIMENSIONS, investors } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { EMBED_BATCH, embedTexts, GeminiUnavailableError } from "@/lib/gemini";
import { runLogger } from "@/lib/logger";
import { startStage } from "@/lib/run-log";
import { companyEmbeddingText } from "@/pipeline/dedupe";
import type { StageResult } from "@/pipeline/ingest/collect";

/**
 * Stage E — enrichment (PRD §10).
 *  1. Embed companies that have a description but no embedding yet (those
 *     created by event extraction, or before the key was configured).
 *  2. Recompute investors.deal_count and total_deployed_usd from deal_investors.
 * Investor alias canonicalisation and prior-round capture happen at write time
 * in Stage C/D (normalize.ts, dedupe.ts); round pairs are read from
 * deals.prior_round_* plus consecutive observed rounds (D-028).
 */

export async function recomputeInvestorCounts(): Promise<number> {
  const res = await getDb().execute(sql`
    UPDATE ${investors} i SET
      deal_count = coalesce(s.n, 0),
      total_deployed_usd = s.capital,
      updated_at = now()
    FROM (
      SELECT inv.id,
             count(DISTINCT di.deal_id)::int AS n,
             sum(d.amount_usd) FILTER (WHERE di.role = 'lead') AS capital
      FROM ${investors} inv
      LEFT JOIN deal_investors di ON di.investor_id = inv.id
      LEFT JOIN deals d ON d.id = di.deal_id
      GROUP BY inv.id
    ) s
    WHERE s.id = i.id
  `);
  return res.rowCount ?? 0;
}

export async function runEnrich(opts: { runId: string; cursor: string | null; deadline: number }): Promise<StageResult> {
  const log = runLogger(opts.runId, "enrich");
  const stage = await startStage(opts.runId, "enrich");
  const db = getDb();
  const env = getEnv();
  let embedded = 0;
  let stopReason: string | null = null;

  if (env.GEMINI_API_KEY && env.GEMINI_EMBEDDING_MODEL) {
    while (Date.now() < opts.deadline) {
      const batch = await db
        .select({
          id: companies.id,
          name: companies.canonicalName,
          description: companies.description,
          subSector: companies.subSector,
          businessModel: companies.businessModel,
          sector: companies.sectorPrimary,
        })
        .from(companies)
        .where(and(isNull(companies.embedding), isNotNull(companies.description)))
        .orderBy(asc(companies.id))
        .limit(EMBED_BATCH);
      if (batch.length === 0) break;
      try {
        const vectors = await embedTexts(
          batch.map((c) =>
            companyEmbeddingText({
              companyName: c.name,
              description: c.description,
              subSector: c.subSector,
              businessModel: c.businessModel,
              sectorPrimary: c.sector ?? "",
            }),
          ),
          { dimensions: EMBEDDING_DIMENSIONS, counters: stage.counters },
        );
        for (let i = 0; i < batch.length; i++) {
          const v = vectors[i];
          const c = batch[i];
          if (!v || !c) continue;
          await db.update(companies).set({ embedding: v, updatedAt: new Date() }).where(eq(companies.id, c.id));
          embedded++;
        }
      } catch (err) {
        if (err instanceof GeminiUnavailableError) {
          stopReason = err.message;
          break;
        }
        throw err;
      }
    }
  }

  const investorsUpdated = await recomputeInvestorCounts();
  stage.counters.itemsOut = embedded;
  await stage.finish(stopReason ? "partial" : "ok", { embedded, investorsUpdated, stopReason });
  log.info("enrich done", { embedded, investorsUpdated });
  return { processed: embedded, next_cursor: null };
}
