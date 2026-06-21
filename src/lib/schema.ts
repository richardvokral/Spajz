// Drizzle schema for Spajz Phase 2 — Neon Postgres persistence.
// Pantry is aggregated by CATEGORY (so "eggs" counts across brands); products and
// price history are tracked per Rohlik product id.

import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  needed: boolean("needed").default(false).notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  rohlikProductId: text("rohlik_product_id").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit"),
  categoryId: uuid("category_id").references(() => categories.id),
  aiCategorized: boolean("ai_categorized").default(false).notNull(),
  mcpCategory: text("mcp_category"),
  mcpCategoryPath: text("mcp_category_path"),
  firstSeenAt: ts("first_seen_at").defaultNow().notNull(),
  lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  rohlikOrderId: text("rohlik_order_id").notNull().unique(),
  orderedAt: ts("ordered_at"),
  total: numeric("total"),
  currency: text("currency"),
  state: text("state"),
  itemsCount: integer("items_count"),
  raw: jsonb("raw"),
  importedAt: ts("imported_at").defaultNow().notNull(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => orders.id, { onDelete: "cascade" })
    .notNull(),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  quantity: numeric("quantity"),
  unit: text("unit"),
  textualAmount: text("textual_amount"),
  price: numeric("price"),
  currency: text("currency"),
});

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    price: numeric("price"),
    currency: text("currency"),
    observedAt: ts("observed_at"),
    rohlikOrderId: text("rohlik_order_id"),
  },
  (t) => [unique("price_history_product_order").on(t.productId, t.rohlikOrderId)]
);

export const pantryItems = pgTable("pantry_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id")
    .references(() => categories.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  quantity: numeric("quantity").default("0").notNull(),
  unit: text("unit"),
  lastBought: ts("last_bought"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

// Per-PRODUCT pantry stock (Phase 3b). Stores only the anchor: the base quantity
// at the moment it was stocked plus when. Remaining and the consumption rate are
// computed on read from order history, so no nightly job is needed. Product rows
// have a UNIQUE product_id (restock re-anchors the same row); free-text rows have
// product_id NULL + a label (multiple NULLs don't collide in Postgres).
export const pantryStock = pgTable("pantry_stock", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .unique(),
  label: text("label"),
  baseQuantity: numeric("base_quantity").default("0").notNull(),
  unit: text("unit"),
  // When set, overrides the history-derived consumption rate (packages/day).
  manualRatePerDay: numeric("manual_rate_per_day"),
  // "Needed" staple flag — surfaced as a heart; groundwork for buy suggestions.
  needed: boolean("needed").default(false).notNull(),
  stockedAt: ts("stocked_at").defaultNow().notNull(),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

// Optional daily snapshot of computed remaining (Phase 3b). Written only when the
// admin toggle `pantry_snapshot_enabled` is on and the cron/webhook endpoint runs;
// the live pantry never reads this. Kept for history and the future buy-suggestion.
export const pantrySnapshots = pgTable("pantry_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  snapshotDate: ts("snapshot_date").defaultNow().notNull(),
  productId: uuid("product_id").references(() => products.id, {
    onDelete: "cascade",
  }),
  label: text("label"),
  remainingPackages: numeric("remaining_packages"),
  createdAt: ts("created_at").defaultNow().notNull(),
});

// Single-row app settings (always id = 1).
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  aiCategorizationEnabled: boolean("ai_categorization_enabled")
    .default(false)
    .notNull(),
  aiParseFallbackEnabled: boolean("ai_parse_fallback_enabled")
    .default(false)
    .notNull(),
  aiModel: text("ai_model").default("claude-opus-4-8").notNull(),
  pantryQuantityMode: text("pantry_quantity_mode").default("package").notNull(),
  pantrySnapshotEnabled: boolean("pantry_snapshot_enabled")
    .default(false)
    .notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const importLogs = pgTable("import_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(), // 'last' | '1month' | '6months'
  status: text("status").notNull(), // 'running' | 'success' | 'error'
  ordersSeen: integer("orders_seen").default(0).notNull(),
  ordersImported: integer("orders_imported").default(0).notNull(),
  itemsImported: integer("items_imported").default(0).notNull(),
  message: text("message"),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
});
