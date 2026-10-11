CREATE TABLE "extracted_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_article_id" integer NOT NULL,
	"kind" text NOT NULL,
	"record_index" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"ingestion_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"deal_id" text,
	"event_id" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_records_article_kind_index_version_unique" UNIQUE("raw_article_id","kind","record_index","prompt_version")
);
--> statement-breakpoint
CREATE TABLE "gemini_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"response" jsonb NOT NULL,
	"tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extracted_records" ADD CONSTRAINT "extracted_records_raw_article_id_raw_articles_id_fk" FOREIGN KEY ("raw_article_id") REFERENCES "public"."raw_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_records" ADD CONSTRAINT "extracted_records_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_records" ADD CONSTRAINT "extracted_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extracted_records_status_idx" ON "extracted_records" USING btree ("status");