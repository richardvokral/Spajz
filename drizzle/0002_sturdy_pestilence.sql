CREATE TABLE "pantry_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid,
	"label" text,
	"remaining_packages" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pantry_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"label" text,
	"base_quantity" numeric DEFAULT '0' NOT NULL,
	"unit" text,
	"stocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_stock_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pantry_snapshot_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pantry_snapshots" ADD CONSTRAINT "pantry_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_stock" ADD CONSTRAINT "pantry_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;