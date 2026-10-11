ALTER TABLE "deal_sources" ADD COLUMN "extracted_record_id" integer;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "reported_stage" text;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "reported_amount_usd" numeric;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "reported_amount_raw" text;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "reported_amount_confidence" text;--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "reported_investors_lead" text[];--> statement-breakpoint
ALTER TABLE "deal_sources" ADD COLUMN "extraction_confidence" numeric;