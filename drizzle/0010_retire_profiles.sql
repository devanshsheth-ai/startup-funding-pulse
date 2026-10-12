ALTER TABLE "profiles" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- D-086: the product runs for Aarav only. The two demo profiles are switched off, not deleted.
UPDATE "profiles" SET "is_active" = false, "is_default" = false, "updated_at" = now() WHERE "id" IN ('fintech-seed-fund', 'consumer-syndicate');
