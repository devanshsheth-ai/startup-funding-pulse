import "dotenv/config";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { getEnv } from "@/lib/env";
import { logger, newRunId } from "@/lib/logger";

/**
 * Applies pending migrations from ./drizzle. Uses Neon's WebSocket Pool (not
 * the HTTP driver) so all pending migrations run inside one transaction: a
 * failure rolls back cleanly instead of leaving a half-applied, unrecorded
 * migration (D-034). This is a local CLI script; serverless routes keep using
 * the HTTP driver (CLAUDE.md §0.4).
 */
async function main(): Promise<void> {
  const log = logger.child({ run_id: newRunId(), stage: "migrate" });
  const started = Date.now();
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  try {
    log.info("migration started");
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    log.info("migration finished", { duration_ms: Date.now() - started });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error("migration failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
