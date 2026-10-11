CREATE TABLE "sector_fit" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"sector" text NOT NULL,
	"sub_sector_key" text NOT NULL,
	"mandate_hash" text NOT NULL,
	"fit" numeric NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_fit_key_unique" UNIQUE("profile_id","sector","sub_sector_key","mandate_hash")
);
--> statement-breakpoint
ALTER TABLE "sector_fit" ADD CONSTRAINT "sector_fit_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_profile_name_unique" UNIQUE("profile_id","name");