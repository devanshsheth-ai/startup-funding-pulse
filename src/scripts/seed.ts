import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sources } from "@/db/schema";
import { logger, newRunId } from "@/lib/logger";

/**
 * Idempotent configuration seed (PRD §20). Upserts by natural key; never
 * touches collected data, and never resets a source's success/failure stats.
 * Seed data is configuration only — no deals, no articles.
 */

const sourceSeed = z.object({
  name: z.string().min(1),
  type: z.enum(["rss", "html", "newsapi", "manual"]),
  url: z.string().url(),
  tier: z.number().int().min(1).max(3),
  parser: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
});
const sourcesFile = z.object({ sources: z.array(sourceSeed).min(1) });

function readSeed<T>(file: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(join(process.cwd(), "seed", file), "utf8")));
}

async function seedSources(): Promise<number> {
  const { sources: rows } = readSeed("sources.json", sourcesFile);
  const urls = new Set(rows.map((r) => r.url));
  if (urls.size !== rows.length) throw new Error("seed/sources.json has duplicate URLs");

  await getDb()
    .insert(sources)
    .values(
      rows.map((r) => ({
        name: r.name,
        type: r.type,
        url: r.url,
        tier: r.tier,
        parser: r.parser,
        enabled: r.enabled,
        config: r.config ?? null,
        // A disabled source states why on /health instead of silently vanishing.
        lastStatus: r.enabled ? null : "disabled",
        lastError: r.enabled ? null : (r.note ?? "Disabled in seed configuration"),
      })),
    )
    .onConflictDoUpdate({
      target: sources.url,
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        tier: sql`excluded.tier`,
        parser: sql`excluded.parser`,
        enabled: sql`excluded.enabled`,
        config: sql`excluded.config`,
        lastStatus: sql`CASE WHEN excluded.enabled THEN ${sources.lastStatus} ELSE 'disabled' END`,
        lastError: sql`CASE WHEN excluded.enabled THEN ${sources.lastError} ELSE excluded.last_error END`,
        updatedAt: new Date(),
      },
    });
  return rows.length;
}

async function main(): Promise<void> {
  const log = logger.child({ run_id: newRunId(), stage: "seed" });
  const n = await seedSources();
  log.info("sources seeded", { count: n });
}

main().catch((err: unknown) => {
  logger.error("seed failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
