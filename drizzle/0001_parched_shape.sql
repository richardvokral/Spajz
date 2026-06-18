ALTER TABLE "products" ADD COLUMN "mcp_category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mcp_category_path" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pantry_quantity_mode" text DEFAULT 'package' NOT NULL;