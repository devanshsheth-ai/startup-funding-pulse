import "dotenv/config";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDb } from "@/db/client";
import { logger, newRunId } from "@/lib/logger";

/**
 * Applies pending migrations from ./drizzle over the Neon HTTP driver.
 * Migration 0000 enables pgvector before any table that uses `vector` exists.
 * Idempotent: already-applied migrations are skipped via drizzle's journal.
 */
async function main(): Promise<void> {
  const log = logger.child({ run_id: newRunId(), stage: "migrate" });
  const started = Date.now();
  log.info("migration started");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  log.info("migration finished", { duration_ms: Date.now() - started });
}

main().catch((err: unknown) => {
  logger.error("migration failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
