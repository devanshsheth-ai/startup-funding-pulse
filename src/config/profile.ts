import { z } from "zod";
import { ALL_STAGES, SECTORS } from "@/lib/taxonomy";

/**
 * The mandate config object (PRD §8), stored in profiles.config. Validated
 * on seed and on every settings write, so scoring never runs on a malformed
 * mandate. Sector names must be taxonomy values; stages must be canonical.
 */

const sector = z.string().refine((s) => SECTORS.includes(s), { message: "not a taxonomy sector" });
const stage = z.string().refine((s) => ALL_STAGES.includes(s), { message: "not a canonical stage" });
const usdRange = z
  .object({ min: z.number().nonnegative(), max: z.number().positive() })
  .refine((r) => r.min <= r.max, { message: "min must be ≤ max" });

export const scoringWeightsSchema = z.object({
  sector_fit: z.number().min(0),
  stage_fit: z.number().min(0),
  cheque_fit: z.number().min(0),
  tracked_investor: z.number().min(0),
  geography_fit: z.number().min(0),
  recency: z.number().min(0),
  ecosystem_significance: z.number().min(0),
  override_watchlist: z.number().min(0),
  override_adjacency_competitor: z.number().min(0),
  override_adjacency_same_layer: z.number().min(0),
  override_adjacency_adjacent: z.number().min(0),
  override_investor_first_move: z.number().min(0),
  confidence_discount_single_source: z.number().min(0).max(1),
});
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

export const mandateConfigSchema = z.object({
  assumption_note: z.string(),
  mandate: z.object({
    country: z.string(),
    geographies_primary: z.array(z.string()),
    geographies_secondary: z.array(z.string()),
    stages: z.array(stage).min(1),
    stages_adjacent: z.array(stage),
    cheque_size_usd: usdRange,
    round_size_interest_usd: usdRange,
  }),
  sectors_core: z.array(z.object({ name: sector, sub: z.array(z.string()) })).min(1),
  sectors_watch: z.array(sector),
  /**
   * A taxonomy sector excludes that whole sector. Any other entry is a label
   * for a sub-sector exclusion, enforced through keywords_excluded (D-045).
   */
  sectors_excluded: z.array(z.string()),
  keywords_excluded: z.array(z.string().min(2)),
  scoring_weights: scoringWeightsSchema,
  tier_thresholds: z
    .object({ act_now: z.number(), high: z.number(), relevant: z.number(), context: z.number() })
    .refine((t) => t.act_now > t.high && t.high > t.relevant && t.relevant > t.context, { message: "tiers must descend" }),
  serendipity: z.object({ enabled: z.boolean(), count: z.number().int().min(0).max(10), max_mandate_score: z.number().min(0) }),
  delivery: z.object({
    mode: z.enum(["weekly", "twice_weekly", "daily", "custom"]),
    days: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])),
    send_hour: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string(),
    recipients: z.array(z.string().email()),
    min_deals_to_send: z.number().int().min(0),
  }),
  alerts: z.object({
    enabled: z.boolean(),
    severity_threshold: z.enum(["critical", "high", "medium", "info"]),
    quiet_hours: z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]),
    max_immediate_per_day: z.number().int().min(0),
    cluster_window_days: z.number().int().min(1),
    cluster_threshold: z.number().int().min(1),
    triggers_enabled: z.record(z.string(), z.boolean()),
  }),
});
export type MandateConfig = z.infer<typeof mandateConfigSchema>;

export const portfolioSeedSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(20),
  sector,
  sub_sector: z.string().nullable(),
  stage_held: stage,
  city: z.string().nullable(),
  relationship_type: z.literal("simulated_holding"),
  // 6–8 specific phrases (CLAUDE.md §7.6); generic one-word sector names are rejected.
  adjacency_keywords: z
    .array(z.string().min(3))
    .min(6)
    .max(8)
    .refine((ks) => ks.every((k) => !SECTORS.map((s) => s.toLowerCase()).includes(k.toLowerCase())), {
      message: "adjacency keywords must be specific, not a bare sector name",
    }),
});

export const watchlistSeedSchema = z.object({
  watch_type: z.enum(["company", "investor", "sector", "keyword"]),
  value: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
});

export const profileSeedSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(1),
  fund_type: z.string(),
  is_default: z.boolean(),
  config: mandateConfigSchema,
  portfolio: z.array(portfolioSeedSchema),
  watchlist: z.array(watchlistSeedSchema),
});
export type ProfileSeed = z.infer<typeof profileSeedSchema>;
