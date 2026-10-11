import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Schema per PRD §7. Deviations are logged in DECISIONS.md:
 *  - every table carries created_at / updated_at (CLAUDE.md §2)            D-006
 *  - digest_items uses a surrogate key + expression unique index, because
 *    Postgres does not allow COALESCE inside a PRIMARY KEY                  D-007
 *  - embeddings are vector(768) to match the configured embedding output   D-003
 */

export const EMBEDDING_DIMENSIONS = 768;

const tz = { withTimezone: true } as const;

const timestamps = {
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz)
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── §7.1 Core entities ────────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  fundType: text("fund_type"),
  config: jsonb("config").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  lastDigestSentAt: timestamp("last_digest_sent_at", tz),
  ...timestamps,
});

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // rss | html | newsapi | manual
  url: text("url").notNull(),
  tier: integer("tier").notNull(),
  parser: text("parser").notNull(),
  config: jsonb("config"), // parser-specific options, e.g. html link pattern (D-016)
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", tz),
  lastStatus: text("last_status"), // ok | error | empty
  lastError: text("last_error"),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  ...timestamps,
}, (t) => [unique("sources_url_unique").on(t.url)]);

export const rawArticles = pgTable("raw_articles", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id),
  url: text("url").notNull(),
  urlHash: text("url_hash").notNull().unique(), // sha256(normalized url), never feed guid
  headline: text("headline"),
  author: text("author"),
  publishedAt: timestamp("published_at", tz),
  fetchedAt: timestamp("fetched_at", tz).notNull().defaultNow(),
  bodyText: text("body_text"),
  categories: text("categories").array(),
  filterVerdict: text("filter_verdict").notNull().default("pending"), // relevant | irrelevant | pending
  eventTypeGuess: text("event_type_guess"),
  processedAt: timestamp("processed_at", tz),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [
  index("raw_articles_filter_verdict_idx").on(t.filterVerdict, t.processedAt),
  index("raw_articles_published_at_idx").on(t.publishedAt),
]);

// ─── §7.2 Companies, investors, deals ──────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  aliases: text("aliases").array(),
  domain: text("domain"),
  description: text("description"),
  sectorPrimary: text("sector_primary"),
  subSector: text("sub_sector"),
  businessModel: text("business_model"),
  hqCity: text("hq_city"),
  hqState: text("hq_state"),
  foundedYear: integer("founded_year"),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  firstSeenAt: timestamp("first_seen_at", tz),
  lastEventAt: timestamp("last_event_at", tz),
  ...timestamps,
}, (t) => [
  unique("companies_normalized_name_hq_city_unique").on(t.normalizedName, t.hqCity),
  index("companies_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  index("companies_domain_idx").on(t.domain),
]);

export const investors = pgTable("investors", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull().unique(),
  normalizedName: text("normalized_name").notNull(),
  aliases: text("aliases").array(),
  investorType: text("investor_type"), // VC | angel | family_office | CVC | PE | accelerator
  firstSeenAt: timestamp("first_seen_at", tz),
  dealCount: integer("deal_count").notNull().default(0),
  totalDeployedUsd: numeric("total_deployed_usd"),
  ...timestamps,
}, (t) => [index("investors_normalized_name_idx").on(t.normalizedName)]);

export const deals = pgTable("deals", {
  id: text("id").primaryKey(), // sha256(normalized_name|round_stage|iso_week)
  companyId: integer("company_id").references(() => companies.id),
  roundStage: text("round_stage").notNull(),
  stageRaw: text("stage_raw"),
  amountRaw: text("amount_raw"),
  amountUsd: numeric("amount_usd"),
  amountInr: numeric("amount_inr"),
  amountConfidence: text("amount_confidence"), // reported | estimated | undisclosed
  fxRateUsed: numeric("fx_rate_used"),
  fxRateDate: date("fx_rate_date"),
  announcedDate: date("announced_date").notNull(),
  isoWeek: text("iso_week"),
  sectorPrimary: text("sector_primary").notNull(),
  sectorSecondary: text("sector_secondary").array(),
  subSector: text("sub_sector"),
  hqCity: text("hq_city"),
  valuationUsd: numeric("valuation_usd"),
  priorRoundStage: text("prior_round_stage"),
  priorRoundDate: date("prior_round_date"),
  corroborationCount: integer("corroboration_count").notNull().default(1),
  extractionConfidence: numeric("extraction_confidence"),
  isVerified: boolean("is_verified").notNull().default(false),
  hasDisputedField: boolean("has_disputed_field").notNull().default(false),
  disputedFields: text("disputed_fields").array(),
  ingestionMode: text("ingestion_mode").notNull(), // live | backfill | manual
  backfillSource: text("backfill_source"),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [
  index("deals_announced_date_idx").on(t.announcedDate.desc()),
  index("deals_iso_week_idx").on(t.isoWeek),
  index("deals_sector_announced_idx").on(t.sectorPrimary, t.announcedDate.desc()),
  index("deals_stage_sector_idx").on(t.roundStage, t.sectorPrimary),
]);

export const dealSources = pgTable("deal_sources", {
  dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  rawArticleId: integer("raw_article_id").notNull().references(() => rawArticles.id),
  publication: text("publication").notNull(),
  url: text("url").notNull(),
  headline: text("headline"),
  publishedAt: timestamp("published_at", tz),
  isPrimary: boolean("is_primary").notNull().default(false),
  // What this source reported — powers merge rules and field-level badges (D-026).
  extractedRecordId: integer("extracted_record_id"),
  reportedStage: text("reported_stage"),
  reportedAmountUsd: numeric("reported_amount_usd"),
  reportedAmountRaw: text("reported_amount_raw"),
  reportedAmountConfidence: text("reported_amount_confidence"),
  reportedInvestorsLead: text("reported_investors_lead").array(),
  extractionConfidence: numeric("extraction_confidence"),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.dealId, t.rawArticleId] })]);

export const dealInvestors = pgTable("deal_investors", {
  dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  investorId: integer("investor_id").notNull().references(() => investors.id),
  role: text("role").notNull(), // lead | participating | existing
  ...timestamps,
}, (t) => [
  primaryKey({ columns: [t.dealId, t.investorId, t.role] }),
  index("deal_investors_investor_idx").on(t.investorId),
]);

// ─── §7.3 Non-funding events ───────────────────────────────────────────────

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(), // ma | shutdown | ipo_filing | layoff | people_move | fund_close | financial_result
  subjectKey: text("subject_key"), // normalised subject for cross-week dedupe (D-027)
  companyId: integer("company_id").references(() => companies.id),
  counterpartyCompanyId: integer("counterparty_company_id").references(() => companies.id),
  headline: text("headline").notNull(),
  detail: text("detail"),
  amountUsd: numeric("amount_usd"),
  eventDate: date("event_date").notNull(),
  isoWeek: text("iso_week"),
  sectorPrimary: text("sector_primary"),
  personName: text("person_name"),
  personRole: text("person_role"),
  moveType: text("move_type"), // joined | departed | promoted | founded
  fromCompany: text("from_company"),
  toCompany: text("to_company"),
  fundName: text("fund_name"),
  fundSizeUsd: numeric("fund_size_usd"),
  fundVintage: integer("fund_vintage"),
  statedFocus: text("stated_focus").array(),
  corroborationCount: integer("corroboration_count").notNull().default(1),
  ingestionMode: text("ingestion_mode").notNull(),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [
  index("events_type_date_idx").on(t.eventType, t.eventDate.desc()),
  index("events_iso_week_idx").on(t.isoWeek),
  index("events_type_subject_idx").on(t.eventType, t.subjectKey),
]);

export const eventSources = pgTable("event_sources", {
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  rawArticleId: integer("raw_article_id").notNull().references(() => rawArticles.id),
  publication: text("publication"),
  url: text("url").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.eventId, t.rawArticleId] })]);

// ─── §7.4 Mandate, scoring, patterns ───────────────────────────────────────

export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  watchType: text("watch_type").notNull(), // company | investor | sector | keyword
  value: text("value").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  aliases: text("aliases").array(),
  companyId: integer("company_id").references(() => companies.id),
  investorId: integer("investor_id").references(() => investors.id),
  notes: text("notes"),
  tags: text("tags").array(),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  status: text("status").notNull().default("watching"), // watching | raised | acquired | dormant
  lastEventAt: timestamp("last_event_at", tz),
  addedAt: timestamp("added_at", tz).notNull().defaultNow(),
  ...timestamps,
}, (t) => [unique("watchlist_profile_type_value_unique").on(t.profileId, t.watchType, t.normalizedValue)]);

export const portfolio = pgTable("portfolio", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sector: text("sector").notNull(),
  subSector: text("sub_sector"),
  stageHeld: text("stage_held"), // UI label: "Assumed stage held" (PRD §8.2)
  relationshipType: text("relationship_type").notNull().default("simulated_holding"),
  city: text("city"),
  investedAt: date("invested_at"),
  adjacencyKeywords: text("adjacency_keywords").array().notNull(),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
}, (t) => [
  index("portfolio_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  unique("portfolio_profile_name_unique").on(t.profileId, t.name),
]);

export const relevanceScores = pgTable("relevance_scores", {
  dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  score: numeric("score").notNull(),
  tier: text("tier").notNull(), // act_now | high | relevant | context | archive
  breakdown: jsonb("breakdown").notNull(),
  reason: text("reason").notNull(),
  isSerendipity: boolean("is_serendipity").notNull().default(false),
  computedAt: timestamp("computed_at", tz).notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  primaryKey({ columns: [t.dealId, t.profileId] }),
  index("relevance_scores_profile_score_idx").on(t.profileId, t.score.desc()),
]);

export const adjacencyEdges = pgTable("adjacency_edges", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolio.id, { onDelete: "cascade" }),
  dealId: text("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  relationship: text("relationship").notNull(), // competitor | same_layer | supplier | customer | complement
  confidence: numeric("confidence").notNull(),
  rationale: text("rationale").notNull(),
  vectorSimilarity: numeric("vector_similarity"),
  detectedAt: timestamp("detected_at", tz).notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  unique("adjacency_edges_portfolio_deal_unique").on(t.portfolioId, t.dealId),
  index("adjacency_edges_profile_detected_idx").on(t.profileId, t.detectedAt),
]);

export const patterns = pgTable("patterns", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id),
  isoWeek: text("iso_week").notNull(),
  detectorKey: text("detector_key").notNull(),
  /** What the pattern is about (a sector, stage, investor pair…); '' for global (D-052). */
  subject: text("subject").notNull().default(""),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  confidence: text("confidence").notNull(), // strong | emerging | weak_signal
  sampleSize: integer("sample_size").notNull(),
  effectSize: numeric("effect_size"),
  statBasis: jsonb("stat_basis").notNull(),
  evidenceDealIds: text("evidence_deal_ids").array(),
  evidenceEventIds: text("evidence_event_ids").array(),
  consecutiveWeeks: integer("consecutive_weeks").notNull().default(1),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [unique("patterns_profile_week_detector_subject_unique").on(t.profileId, t.isoWeek, t.detectorKey, t.subject)]);

/**
 * Every detector's outcome per profile per week — fired, quiet or suppressed,
 * with the reason and the gate values — so suppression is shown on
 * /methodology instead of silently absent (PRD §14.1).
 */
export const detectorRuns = pgTable("detector_runs", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  isoWeek: text("iso_week").notNull(),
  detectorKey: text("detector_key").notNull(),
  status: text("status").notNull(), // fired | quiet | suppressed
  reason: text("reason").notNull(),
  gates: jsonb("gates").notNull(), // { n_min, e_min, b_min, observed: { n, effect, baseline_weeks } }
  findings: integer("findings").notNull().default(0),
  runId: text("run_id").notNull(),
  ...timestamps,
}, (t) => [
  unique("detector_runs_profile_week_key_unique").on(t.profileId, t.isoWeek, t.detectorKey),
]);

export const marketMapClusters = pgTable("market_map_clusters", {
  id: serial("id").primaryKey(),
  sector: text("sector").notNull(),
  clusterLabel: text("cluster_label").notNull(),
  companyIds: integer("company_ids").array(),
  dealCount: integer("deal_count"),
  totalCapitalUsd: numeric("total_capital_usd"),
  topInvestors: text("top_investors").array(),
  centroid: vector("centroid", { dimensions: EMBEDDING_DIMENSIONS }),
  computedAt: timestamp("computed_at", tz).notNull().defaultNow(),
  ...timestamps,
}, (t) => [index("market_map_clusters_sector_idx").on(t.sector)]);

// ─── §7.5 Delivery and operations ──────────────────────────────────────────

export const digests = pgTable("digests", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id),
  mode: text("mode").notNull(), // weekly | daily
  windowStart: timestamp("window_start", tz).notNull(),
  windowEnd: timestamp("window_end", tz).notNull(),
  isoWeek: text("iso_week"),
  headline: text("headline").notNull(),
  tldr: jsonb("tldr").notNull(),
  narrative: jsonb("narrative").notNull(),
  aggregates: jsonb("aggregates").notNull(),
  shareToken: text("share_token").unique(),
  emailSentAt: timestamp("email_sent_at", tz),
  emailStatus: text("email_status"),
  generatedAt: timestamp("generated_at", tz).notNull().defaultNow(),
  ...timestamps,
}, (t) => [index("digests_profile_generated_idx").on(t.profileId, t.generatedAt.desc())]);

export const digestItems = pgTable("digest_items", {
  id: serial("id").primaryKey(),
  digestId: integer("digest_id").notNull().references(() => digests.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id),
  eventId: text("event_id").references(() => events.id),
  section: text("section").notNull(), // watchlist | adjacency | ranked | outside_mandate | exits | fund_closes | people | investors
  rank: integer("rank"),
  ...timestamps,
}, (t) => [
  uniqueIndex("digest_items_identity_unique").on(
    t.digestId,
    sql`coalesce(${t.dealId}, '')`,
    sql`coalesce(${t.eventId}, '')`,
    t.section,
  ),
]);

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id),
  severity: text("severity").notNull(), // critical | high | medium | info
  triggerKey: text("trigger_key").notNull(),
  portfolioId: integer("portfolio_id").references(() => portfolio.id),
  watchlistId: integer("watchlist_id").references(() => watchlist.id),
  dealId: text("deal_id").references(() => deals.id),
  eventId: text("event_id").references(() => events.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | queued | sent | suppressed | batched
  suppressedReason: text("suppressed_reason"),
  sentAt: timestamp("sent_at", tz),
  ...timestamps,
}, (t) => [index("alerts_profile_status_idx").on(t.profileId, t.status)]);

export const runLogs = pgTable("run_logs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  stage: text("stage").notNull(),
  startedAt: timestamp("started_at", tz).notNull(),
  finishedAt: timestamp("finished_at", tz),
  status: text("status").notNull(), // running | ok | partial | error
  itemsIn: integer("items_in"),
  itemsOut: integer("items_out"),
  geminiCalls: integer("gemini_calls"),
  geminiTokens: integer("gemini_tokens"),
  error: text("error"),
  detail: jsonb("detail"),
  ...timestamps,
}, (t) => [
  index("run_logs_run_id_idx").on(t.runId),
  index("run_logs_started_at_idx").on(t.startedAt.desc()),
]);

export const quarantine = pgTable("quarantine", {
  id: serial("id").primaryKey(),
  stage: text("stage").notNull(),
  rawArticleId: integer("raw_article_id"),
  payload: jsonb("payload"),
  error: text("error").notNull(),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [index("quarantine_stage_idx").on(t.stage, t.createdAt)]);

export const fxRates = pgTable("fx_rates", {
  date: date("date").primaryKey(),
  usdInr: numeric("usd_inr").notNull(),
  source: text("source").notNull(),
  ...timestamps,
});

// ─── Pipeline staging and caches (not in PRD §7; see DECISIONS D-023, D-024) ─

/**
 * Stage B output, before normalisation and dedupe: one row per candidate
 * record extracted from an article. The "candidate records" step of the
 * dedupe funnel (PRD §10 Stage D).
 */
export const extractedRecords = pgTable("extracted_records", {
  id: serial("id").primaryKey(),
  rawArticleId: integer("raw_article_id").notNull().references(() => rawArticles.id),
  kind: text("kind").notNull(), // funding | event
  recordIndex: integer("record_index").notNull().default(0),
  payload: jsonb("payload").notNull(), // Zod-validated extraction
  promptVersion: text("prompt_version").notNull(),
  ingestionMode: text("ingestion_mode").notNull(), // live | backfill | manual
  status: text("status").notNull().default("pending"), // pending | merged | rejected
  rejectReason: text("reject_reason"),
  dealId: text("deal_id").references(() => deals.id),
  eventId: text("event_id").references(() => events.id),
  runId: text("run_id"),
  ...timestamps,
}, (t) => [
  unique("extracted_records_article_kind_index_version_unique").on(t.rawArticleId, t.kind, t.recordIndex, t.promptVersion),
  index("extracted_records_status_idx").on(t.status),
]);

/** Gemini response cache keyed by sha256(model | prompt version | input). */
export const geminiCache = pgTable("gemini_cache", {
  key: text("key").primaryKey(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  response: jsonb("response").notNull(),
  tokens: integer("tokens"),
  ...timestamps,
});

/**
 * Gemini sector-fit verdicts, cached per (profile, sector, sub-sector, mandate
 * hash) so a deal never triggers its own call (PRD §11.1). Editing the mandate
 * changes the hash and therefore re-evaluates (D-046).
 */
export const sectorFit = pgTable("sector_fit", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sector: text("sector").notNull(),
  subSectorKey: text("sub_sector_key").notNull(), // lowercased sub-sector, '' when absent
  mandateHash: text("mandate_hash").notNull(),
  fit: numeric("fit").notNull(), // 0..1
  reason: text("reason").notNull(),
  ...timestamps,
}, (t) => [unique("sector_fit_key_unique").on(t.profileId, t.sector, t.subSectorKey, t.mandateHash)]);
