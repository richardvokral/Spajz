ALTER TABLE "categories" ADD COLUMN "needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_stock" ADD COLUMN "manual_rate_per_day" numeric;--> statement-breakpoint
ALTER TABLE "pantry_stock" ADD COLUMN "needed" boolean DEFAULT false NOT NULL;