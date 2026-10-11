CREATE TABLE "detector_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"iso_week" text NOT NULL,
	"detector_key" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"gates" jsonb NOT NULL,
	"findings" integer DEFAULT 0 NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detector_runs_profile_week_key_unique" UNIQUE("profile_id","iso_week","detector_key")
);
--> statement-breakpoint
ALTER TABLE "patterns" DROP CONSTRAINT "patterns_profile_week_detector_unique";--> statement-breakpoint
ALTER TABLE "patterns" ADD COLUMN "subject" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "patterns" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "detector_runs" ADD CONSTRAINT "detector_runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_profile_week_detector_subject_unique" UNIQUE("profile_id","iso_week","detector_key","subject");