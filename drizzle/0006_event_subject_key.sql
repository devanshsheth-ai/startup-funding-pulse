ALTER TABLE "events" ADD COLUMN "subject_key" text;--> statement-breakpoint
CREATE INDEX "events_type_subject_idx" ON "events" USING btree ("event_type","subject_key");