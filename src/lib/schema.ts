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
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  rohlikProductId: text("rohlik_product_id").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit"),
  categoryId: uuid("category_id").references(() => categories.id),
  aiCategorized: boolean("ai_categorized").default(false).notNull(),
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
