import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { portfolio, profiles, sources, watchlist } from "@/db/schema";
import { profileSeedSchema, type ProfileSeed } from "@/config/profile";
import { logger, newRunId } from "@/lib/logger";
import { normalizeCompanyName, watchKey } from "@/pipeline/normalize";

/**
 * Idempotent configuration seed (PRD §20). Upserts by natural key; never
 * touches collected data, and never resets a source's success/failure stats.
 * Seed data is configuration only — no deals, no articles.
 */

const sourceSeed = z.object({
  name: z.string().min(1),
  type: z.enum(["rss", "html", "newsapi", "manual", "roundup"]),
  url: z.string().url(),
  tier: z.number().int().min(1).max(3),
  parser: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  /** "backfill": a roundup source used only by the backfill script. */
  role: z.enum(["live", "backfill"]).default("live"),
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
        lastStatus: r.role === "backfill" ? "backfill_only" : r.enabled ? null : "disabled",
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
        lastStatus: sql`CASE WHEN excluded.last_status = 'backfill_only' THEN 'backfill_only' WHEN excluded.enabled THEN ${sources.lastStatus} ELSE 'disabled' END`,
        lastError: sql`CASE WHEN excluded.enabled THEN ${sources.lastError} ELSE excluded.last_error END`,
        updatedAt: new Date(),
      },
    });
  return rows.length;
}

const PROFILE_FILES = ["profile-aarav.json"];


/** Portfolio and watchlist must not overlap (PRD §8.1). Throws on violation. */
export function assertNoOverlap(p: ProfileSeed): void {
  const held = new Set(p.portfolio.map((c) => normalizeCompanyName(c.name)));
  const clash = p.watchlist.filter((w) => w.watch_type === "company" && held.has(normalizeCompanyName(w.value)));
  if (clash.length) throw new Error(`${p.id}: watchlist overlaps portfolio: ${clash.map((c) => c.value).join(", ")}`);
}

async function seedProfiles(): Promise<{ profiles: number; portfolio: number; watchlist: number }> {
  const db = getDb();
  const seeds = PROFILE_FILES.map((f) => readSeed(f, profileSeedSchema));
  if (seeds.filter((s) => s.is_default).length !== 1) throw new Error("exactly one profile must be is_default");
  let pf = 0;
  let wl = 0;
  for (const p of seeds) {
    assertNoOverlap(p);
    await db
      .insert(profiles)
      .values({ id: p.id, displayName: p.display_name, fundType: p.fund_type, config: p.config, isDefault: p.is_default })
      .onConflictDoUpdate({
        target: profiles.id,
        // last_digest_sent_at is never touched by seeding (window semantics, CLAUDE.md §7.2).
        set: { displayName: sql`excluded.display_name`, fundType: sql`excluded.fund_type`, config: sql`excluded.config`, isDefault: sql`excluded.is_default`, updatedAt: new Date() },
      });
    for (const c of p.portfolio) {
      await db
        .insert(portfolio)
        .values({
          profileId: p.id,
          name: c.name,
          description: c.description,
          sector: c.sector,
          subSector: c.sub_sector,
          stageHeld: c.stage_held,
          relationshipType: c.relationship_type,
          city: c.city,
          adjacencyKeywords: c.adjacency_keywords,
        })
        .onConflictDoUpdate({
          target: [portfolio.profileId, portfolio.name],
          set: {
            // A changed description or keyword set invalidates the embedding.
            embedding: sql`CASE WHEN ${portfolio.description} = excluded.description AND ${portfolio.adjacencyKeywords} = excluded.adjacency_keywords THEN ${portfolio.embedding} ELSE NULL END`,
            description: sql`excluded.description`,
            sector: sql`excluded.sector`,
            subSector: sql`excluded.sub_sector`,
            stageHeld: sql`excluded.stage_held`,
            relationshipType: sql`excluded.relationship_type`,
            city: sql`excluded.city`,
            adjacencyKeywords: sql`excluded.adjacency_keywords`,
            isActive: true,
            updatedAt: new Date(),
          },
        });
      pf++;
    }
    for (const w of p.watchlist) {
      await db
        .insert(watchlist)
        .values({
          profileId: p.id,
          watchType: w.watch_type,
          value: w.value,
          normalizedValue: watchKey(w.watch_type, w.value),
          aliases: w.aliases,
          notes: w.notes,
          tags: w.tags,
        })
        .onConflictDoUpdate({
          target: [watchlist.profileId, watchlist.watchType, watchlist.normalizedValue],
          set: { value: sql`excluded.value`, aliases: sql`excluded.aliases`, updatedAt: new Date() },
        });
      wl++;
    }
  }
  return { profiles: seeds.length, portfolio: pf, watchlist: wl };
}

async function main(): Promise<void> {
  const log = logger.child({ run_id: newRunId(), stage: "seed" });
  const n = await seedSources();
  log.info("sources seeded", { count: n });
  log.info("profiles seeded", { ...(await seedProfiles()) });
}

main().catch((err: unknown) => {
  logger.error("seed failed", { error: err instanceof Error ? err : String(err) });
  process.exit(1);
});
