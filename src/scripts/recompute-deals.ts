import "dotenv/config";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";
import { recomputeDeal } from "@/pipeline/dedupe";

/** Re-derive every deal's merged fields from its sources (after a merge-rule change). Idempotent. */
async function main(): Promise<void> {
  const ids = z.array(z.object({ id: z.string() })).parse((await getDb().execute(sql`SELECT id FROM deals ORDER BY id`)).rows);
  const before = (await getDb().execute(sql`SELECT md5(string_agg(id || round_stage || coalesce(amount_usd::text, '') || corroboration_count, ',' ORDER BY id)) AS h FROM deals`)).rows[0] as { h: string };
  for (const { id } of ids) await recomputeDeal(id);
  const after = (await getDb().execute(sql`SELECT md5(string_agg(id || round_stage || coalesce(amount_usd::text, '') || corroboration_count, ',' ORDER BY id)) AS h FROM deals`)).rows[0] as { h: string };
  logger.info("deals recomputed", { deals: ids.length, changed: before.h !== after.h });
}
main().catch((err: unknown) => {
  logger.error("recompute failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
