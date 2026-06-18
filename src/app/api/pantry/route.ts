import { NextResponse } from "next/server";
import { eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { categories, orderItems, orders, products } from "@/lib/schema";
import { getSettings } from "@/lib/settings";
import { parseTextualAmount } from "@/lib/pantry/parseAmount";

export const runtime = "nodejs";

interface ProductAgg {
  name: string;
  mcpCategory: string | null;
  aiCategory: string | null;
  packageCount: number;
  lastBought: string | null;
  textualAmount: string | null;
  unit: string | null;
}

interface PantryItem {
  name: string;
  mcpCategory: string | null;
  packageCount: number;
  contentAmount: number | null;
  contentUnit: string | null;
  textualAmount: string | null;
  unit: string | null;
  lastBought: string | null;
}

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({
      ok: true,
      dbConfigured: false,
      pantryQuantityMode: "package",
      categories: [],
    });
  }

  try {
    const db = getDb();
    const settings = await getSettings();

    // Matched lines, aggregated per product.
    const matched = await db
      .select({
        name: products.name,
        mcpCategory: products.mcpCategory,
        aiCategory: categories.name,
        packageCount: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
        lastBought: sql<string | null>`max(${orders.orderedAt})`,
        textualAmount: sql<string | null>`max(${orderItems.textualAmount})`,
        unit: sql<string | null>`max(${orderItems.unit})`,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(orders, eq(orderItems.orderId, orders.id))
      .where(isNotNull(orderItems.productId))
      .groupBy(products.name, products.mcpCategory, categories.name);

    // Unmatched lines (no product id), grouped by line name.
    const unmatched = await db
      .select({
        name: orderItems.name,
        packageCount: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
        lastBought: sql<string | null>`max(${orders.orderedAt})`,
        textualAmount: sql<string | null>`max(${orderItems.textualAmount})`,
        unit: sql<string | null>`max(${orderItems.unit})`,
      })
      .from(orderItems)
      .leftJoin(orders, eq(orderItems.orderId, orders.id))
      .where(isNull(orderItems.productId))
      .groupBy(orderItems.name);

    const aggregates: ProductAgg[] = [
      ...matched.map((m) => ({
        name: m.name ?? "Unknown item",
        mcpCategory: m.mcpCategory,
        aiCategory: m.aiCategory,
        packageCount: Number(m.packageCount ?? 0),
        lastBought: m.lastBought,
        textualAmount: m.textualAmount,
        unit: m.unit,
      })),
      ...unmatched.map((u) => ({
        name: u.name,
        mcpCategory: null,
        aiCategory: null,
        packageCount: Number(u.packageCount ?? 0),
        lastBought: u.lastBought,
        textualAmount: u.textualAmount,
        unit: u.unit,
      })),
    ];

    // Group by display category (AI primary, Rohlik fallback, else Uncategorized).
    const groups = new Map<
      string,
      { items: PantryItem[]; content: Map<string, number>; packageTotal: number }
    >();
    for (const a of aggregates) {
      const category = a.aiCategory ?? a.mcpCategory ?? "Uncategorized";
      const parsed = parseTextualAmount(a.textualAmount);
      const contentAmount = parsed ? a.packageCount * parsed.amount : null;
      const contentUnit = parsed?.unit ?? null;

      const g =
        groups.get(category) ??
        { items: [], content: new Map<string, number>(), packageTotal: 0 };
      g.items.push({
        name: a.name,
        mcpCategory: a.mcpCategory,
        packageCount: a.packageCount,
        contentAmount,
        contentUnit,
        textualAmount: a.textualAmount,
        unit: a.unit,
        lastBought: a.lastBought,
      });
      g.packageTotal += a.packageCount;
      if (contentUnit && contentAmount != null) {
        g.content.set(contentUnit, (g.content.get(contentUnit) ?? 0) + contentAmount);
      }
      groups.set(category, g);
    }

    const result = [...groups.entries()]
      .map(([category, g]) => ({
        category,
        packageTotal: g.packageTotal,
        content: [...g.content.entries()].map(([unit, amount]) => ({ unit, amount })),
        items: g.items.sort((a, b) =>
          (b.lastBought ?? "").localeCompare(a.lastBought ?? "")
        ),
      }))
      .sort((a, b) => {
        if (a.category === "Uncategorized") return 1;
        if (b.category === "Uncategorized") return -1;
        return a.category.localeCompare(b.category);
      });

    return NextResponse.json({
      ok: true,
      dbConfigured: true,
      pantryQuantityMode: settings.pantryQuantityMode,
      categories: result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        dbConfigured: true,
        pantryQuantityMode: "package",
        categories: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
