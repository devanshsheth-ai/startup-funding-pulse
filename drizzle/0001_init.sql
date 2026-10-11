CREATE TABLE "adjacency_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"portfolio_id" integer NOT NULL,
	"deal_id" text NOT NULL,
	"relationship" text NOT NULL,
	"confidence" numeric NOT NULL,
	"rationale" text NOT NULL,
	"vector_similarity" numeric,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjacency_edges_portfolio_deal_unique" UNIQUE("portfolio_id","deal_id")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text,
	"severity" text NOT NULL,
	"trigger_key" text NOT NULL,
	"portfolio_id" integer,
	"watchlist_id" integer,
	"deal_id" text,
	"event_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suppressed_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[],
	"domain" text,
	"description" text,
	"sector_primary" text,
	"sub_sector" text,
	"business_model" text,
	"hq_city" text,
	"hq_state" text,
	"founded_year" integer,
	"embedding" vector(768),
	"first_seen_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_normalized_name_hq_city_unique" UNIQUE("normalized_name","hq_city")
);
--> statement-breakpoint
CREATE TABLE "deal_investors" (
	"deal_id" text NOT NULL,
	"investor_id" integer NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_investors_deal_id_investor_id_role_pk" PRIMARY KEY("deal_id","investor_id","role")
);
--> statement-breakpoint
CREATE TABLE "deal_sources" (
	"deal_id" text NOT NULL,
	"raw_article_id" integer NOT NULL,
	"publication" text NOT NULL,
	"url" text NOT NULL,
	"headline" text,
	"published_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_sources_deal_id_raw_article_id_pk" PRIMARY KEY("deal_id","raw_article_id")
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" integer,
	"round_stage" text NOT NULL,
	"stage_raw" text,
	"amount_raw" text,
	"amount_usd" numeric,
	"amount_inr" numeric,
	"amount_confidence" text,
	"fx_rate_used" numeric,
	"fx_rate_date" date,
	"announced_date" date NOT NULL,
	"iso_week" text,
	"sector_primary" text NOT NULL,
	"sector_secondary" text[],
	"sub_sector" text,
	"hq_city" text,
	"valuation_usd" numeric,
	"prior_round_stage" text,
	"prior_round_date" date,
	"corroboration_count" integer DEFAULT 1 NOT NULL,
	"extraction_confidence" numeric,
	"is_verified" boolean DEFAULT false NOT NULL,
	"has_disputed_field" boolean DEFAULT false NOT NULL,
	"disputed_fields" text[],
	"ingestion_mode" text NOT NULL,
	"backfill_source" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_id" integer NOT NULL,
	"deal_id" text,
	"event_id" text,
	"section" text NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text,
	"mode" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"iso_week" text,
	"headline" text NOT NULL,
	"tldr" jsonb NOT NULL,
	"narrative" jsonb NOT NULL,
	"aggregates" jsonb NOT NULL,
	"share_token" text,
	"email_sent_at" timestamp with time zone,
	"email_status" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digests_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"event_id" text NOT NULL,
	"raw_article_id" integer NOT NULL,
	"publication" text,
	"url" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sources_event_id_raw_article_id_pk" PRIMARY KEY("event_id","raw_article_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"company_id" integer,
	"counterparty_company_id" integer,
	"headline" text NOT NULL,
	"detail" text,
	"amount_usd" numeric,
	"event_date" date NOT NULL,
	"iso_week" text,
	"sector_primary" text,
	"person_name" text,
	"person_role" text,
	"move_type" text,
	"from_company" text,
	"to_company" text,
	"fund_name" text,
	"fund_size_usd" numeric,
	"fund_vintage" integer,
	"stated_focus" text[],
	"corroboration_count" integer DEFAULT 1 NOT NULL,
	"ingestion_mode" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date PRIMARY KEY NOT NULL,
	"usd_inr" numeric NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[],
	"investor_type" text,
	"first_seen_at" timestamp with time zone,
	"deal_count" integer DEFAULT 0 NOT NULL,
	"total_deployed_usd" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investors_canonical_name_unique" UNIQUE("canonical_name")
);
--> statement-breakpoint
CREATE TABLE "market_map_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"cluster_label" text NOT NULL,
	"company_ids" integer[],
	"deal_count" integer,
	"total_capital_usd" numeric,
	"top_investors" text[],
	"centroid" vector(768),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text,
	"iso_week" text NOT NULL,
	"detector_key" text NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"confidence" text NOT NULL,
	"sample_size" integer NOT NULL,
	"effect_size" numeric,
	"stat_basis" jsonb NOT NULL,
	"evidence_deal_ids" text[],
	"evidence_event_ids" text[],
	"consecutive_weeks" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patterns_profile_week_detector_unique" UNIQUE("profile_id","iso_week","detector_key")
);
--> statement-breakpoint
CREATE TABLE "portfolio" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sector" text NOT NULL,
	"sub_sector" text,
	"stage_held" text,
	"relationship_type" text DEFAULT 'simulated_holding' NOT NULL,
	"city" text,
	"invested_at" date,
	"adjacency_keywords" text[] NOT NULL,
	"embedding" vector(768),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"fund_type" text,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_digest_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantine" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"raw_article_id" integer,
	"payload" jsonb,
	"error" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"headline" text,
	"author" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body_text" text,
	"categories" text[],
	"filter_verdict" text DEFAULT 'pending' NOT NULL,
	"event_type_guess" text,
	"processed_at" timestamp with time zone,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_articles_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "relevance_scores" (
	"deal_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"score" numeric NOT NULL,
	"tier" text NOT NULL,
	"breakdown" jsonb NOT NULL,
	"reason" text NOT NULL,
	"is_serendipity" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relevance_scores_deal_id_profile_id_pk" PRIMARY KEY("deal_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"items_in" integer,
	"items_out" integer,
	"gemini_calls" integer,
	"gemini_tokens" integer,
	"error" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"tier" integer NOT NULL,
	"parser" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"watch_type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"aliases" text[],
	"company_id" integer,
	"investor_id" integer,
	"notes" text,
	"tags" text[],
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'watching' NOT NULL,
	"last_event_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_profile_type_value_unique" UNIQUE("profile_id","watch_type","normalized_value")
);
--> statement-breakpoint
ALTER TABLE "adjacency_edges" ADD CONSTRAINT "adjacency_edges_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjacency_edges" ADD CONSTRAINT "adjacency_edges_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjacency_edges" ADD CONSTRAINT "adjacency_edges_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_portfolio_id_portfolio_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_watchlist_id_watchlist_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_investors" ADD CONSTRAINT "deal_investors_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_investors" ADD CONSTRAINT "deal_investors_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD CONSTRAINT "deal_sources_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD CONSTRAINT "deal_sources_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_counterparty_company_id_companies_id_fk" FOREIGN KEY ("counterparty_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_articles" ADD CONSTRAINT "raw_articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_scores" ADD CONSTRAINT "relevance_scores_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_scores" ADD CONSTRAINT "relevance_scores_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjacency_edges_profile_detected_idx" ON "adjacency_edges" USING btree ("profile_id","detected_at");--> statement-breakpoint
CREATE INDEX "alerts_profile_status_idx" ON "alerts" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "companies_embedding_hnsw_idx" ON "companies" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "deal_investors_investor_idx" ON "deal_investors" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "deals_announced_date_idx" ON "deals" USING btree ("announced_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deals_iso_week_idx" ON "deals" USING btree ("iso_week");--> statement-breakpoint
CREATE INDEX "deals_sector_announced_idx" ON "deals" USING btree ("sector_primary","announced_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deals_stage_sector_idx" ON "deals" USING btree ("round_stage","sector_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_items_identity_unique" ON "digest_items" USING btree ("digest_id",coalesce("deal_id", ''),coalesce("event_id", ''),"section");--> statement-breakpoint
CREATE INDEX "digests_profile_generated_idx" ON "digests" USING btree ("profile_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_type_date_idx" ON "events" USING btree ("event_type","event_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_iso_week_idx" ON "events" USING btree ("iso_week");--> statement-breakpoint
CREATE INDEX "investors_normalized_name_idx" ON "investors" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "market_map_clusters_sector_idx" ON "market_map_clusters" USING btree ("sector");--> statement-breakpoint
CREATE INDEX "portfolio_embedding_hnsw_idx" ON "portfolio" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "quarantine_stage_idx" ON "quarantine" USING btree ("stage","created_at");--> statement-breakpoint
CREATE INDEX "raw_articles_filter_verdict_idx" ON "raw_articles" USING btree ("filter_verdict","processed_at");--> statement-breakpoint
CREATE INDEX "raw_articles_published_at_idx" ON "raw_articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "relevance_scores_profile_score_idx" ON "relevance_scores" USING btree ("profile_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "run_logs_run_id_idx" ON "run_logs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_logs_started_at_idx" ON "run_logs" USING btree ("started_at" DESC NULLS LAST);