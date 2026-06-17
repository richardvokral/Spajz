import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb, isDbConfigured } from "@/lib/db";
import {
  categories,
  importLogs,
  orderItems,
  orders,
  pantryItems,
  priceHistory,
  products,
} from "@/lib/schema";
import { appliedMigrations, definedMigrations } from "@/lib/migrations";
import { getSettings } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";

export const runtime = "nodejs";

async function countOf(
  db: ReturnType<typeof getDb>,
  table: PgTable
): Promise<number> {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(table);
  return Number(r[0]?.c ?? 0);
}

export async function GET() {
  const dbConfigured = isDbConfigured();
  const anthropicConfigured = isAiConfigured();
  const defined = definedMigrations();

  if (!dbConfigured) {
    return NextResponse.json({
      dbConfigured,
      anthropicConfigured,
      definedMigrations: defined,
      appliedMigrations: [],
      migrated: false,
      counts: null,
      settings: null,
      importLogs: [],
    });
  }

  const db = getDb();
  const applied = await appliedMigrations(db);

  let counts: Record<string, number> | null = null;
  let settings = null;
  let logs: unknown[] = [];
  let migrated = false;
  try {
    counts = {
      categories: await countOf(db, categories),
      products: await countOf(db, products),
      orders: await countOf(db, orders),
      orderItems: await countOf(db, orderItems),
      priceHistory: await countOf(db, priceHistory),
      pantryItems: await countOf(db, pantryItems),
    };
    settings = await getSettings();
    logs = await db
      .select()
      .from(importLogs)
      .orderBy(desc(importLogs.startedAt))
      .limit(10);
    migrated = true;
  } catch {
    // tables not created yet — run migrations
  }

  return NextResponse.json({
    dbConfigured,
    anthropicConfigured,
    definedMigrations: defined,
    appliedMigrations: applied,
    migrated,
    counts,
    settings,
    importLogs: logs,
  });
}
