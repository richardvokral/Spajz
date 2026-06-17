// Drizzle schema. Scaffold for Phase 2 (purchase history + server-side pantry).
// The MVP does NOT use these tables — the pantry lives in browser localStorage.

import {
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  logtoSub: text("logto_sub").unique(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const purchases = pgTable("purchases", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  rohlikOrderId: text("rohlik_order_id"),
  productId: text("product_id"),
  name: text("name").notNull(),
  quantity: numeric("quantity"),
  unit: text("unit"),
  price: numeric("price"),
  boughtAt: timestamp("bought_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pantryItems = pgTable("pantry_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  productId: text("product_id"),
  name: text("name").notNull(),
  quantity: numeric("quantity"),
  unit: text("unit"),
  lastBought: timestamp("last_bought"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
