import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { categories, pantryStock, products } from "@/lib/schema";
import { computeRates, contentFor, project, restockProduct } from "@/lib/pantry/stock";

export const runtime = "nodejs";

const OTHER = "Other";
const UNCATEGORIZED = "Uncategorized";

interface StockItem {
  id: string;
  productId: string | null;
  name: string;
  unit: string | null;
  baseQuantity: number;
  remaining: number;
  remainingContent: number | null;
  contentUnit: string | null;
  ratePerWeek: number;
  manual: boolean;
  needed: boolean;
  daysUntilEmpty: number | null;
  stockedAt: Date;
  lastBought: string | null;
}

function urgency(a: StockItem, b: StockItem): number {
  if (a.daysUntilEmpty == null && b.daysUntilEmpty == null)
    return a.name.localeCompare(b.name);
  if (a.daysUntilEmpty == null) return 1;
  if (b.daysUntilEmpty == null) return -1;
  return a.daysUntilEmpty - b.daysUntilEmpty;
}

// GET — pantry stock grouped by category, each item with on-read remaining, weekly
// rate (manual override or history) and days-until-empty. Sorted by urgency.
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, dbConfigured: false, groups: [] });
  }

  try {
    const db = getDb();
    const rates = await computeRates(db);

    const rows = await db
      .select({
        id: pantryStock.id,
        productId: pantryStock.productId,
        label: pantryStock.label,
        baseQuantity: pantryStock.baseQuantity,
        unit: pantryStock.unit,
        manualRatePerDay: pantryStock.manualRatePerDay,
        needed: pantryStock.needed,
        stockedAt: pantryStock.stockedAt,
        productName: products.name,
        productUnit: products.unit,
        mcpCategory: products.mcpCategory,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryNeeded: categories.needed,
      })
      .from(pantryStock)
      .leftJoin(products, eq(pantryStock.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id));

    const now = new Date();
    const groups = new Map<
      string,
      { category: string; categoryId: string | null; needed: boolean; items: StockItem[] }
    >();

    for (const r of rows) {
      const rate = r.productId ? rates.get(r.productId) : undefined;
      const manual = r.manualRatePerDay != null;
      const ratePerDay = manual ? Number(r.manualRatePerDay) : rate?.ratePerDay ?? 0;
      const base = Number(r.baseQuantity ?? 0);
      const { remaining, daysUntilEmpty } = project(base, new Date(r.stockedAt), ratePerDay, now);
      const content = contentFor(remaining, rate?.textualAmount ?? null);

      const item: StockItem = {
        id: r.id,
        productId: r.productId,
        name: r.productName ?? r.label ?? "Unknown item",
        unit: r.unit ?? r.productUnit ?? null,
        baseQuantity: base,
        remaining: Math.round(remaining * 100) / 100,
        remainingContent: content?.amount ?? null,
        contentUnit: content?.unit ?? null,
        ratePerWeek: Math.round(ratePerDay * 7 * 100) / 100,
        manual,
        needed: r.needed,
        daysUntilEmpty: daysUntilEmpty != null ? Math.round(daysUntilEmpty) : null,
        stockedAt: r.stockedAt,
        lastBought: rate?.lastBought ?? null,
      };

      // Heart only on real AI categories; everything else falls under Other/Uncategorized.
      const key = r.categoryName ?? r.mcpCategory ?? (r.productId ? UNCATEGORIZED : OTHER);
      const g =
        groups.get(key) ??
        {
          category: key,
          categoryId: r.categoryName ? r.categoryId : null,
          needed: r.categoryName ? Boolean(r.categoryNeeded) : false,
          items: [],
        };
      g.items.push(item);
      groups.set(key, g);
    }

    const result = [...groups.values()]
      .map((g) => ({ ...g, items: g.items.sort(urgency) }))
      .sort((a, b) => {
        const tail = (c: string) => c === OTHER || c === UNCATEGORIZED;
        if (tail(a.category) !== tail(b.category)) return tail(a.category) ? 1 : -1;
        const au = a.items[0]?.daysUntilEmpty ?? null;
        const bu = b.items[0]?.daysUntilEmpty ?? null;
        if (au == null && bu == null) return a.category.localeCompare(b.category);
        if (au == null) return 1;
        if (bu == null) return -1;
        return au - bu;
      });

    return NextResponse.json({ ok: true, dbConfigured: true, groups: result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// POST — manual add. Either an existing product (re-anchors on top of current
// estimated remaining) or a free-text row (static, no decay).
const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("product"),
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    unit: z.string().optional(),
  }),
  z.object({
    mode: z.literal("freeText"),
    label: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string().optional(),
  }),
]);

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set." }, { status: 500 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const db = getDb();
    if (body.mode === "product") {
      const rates = await computeRates(db);
      const ratePerDay = rates.get(body.productId)?.ratePerDay ?? 0;
      const action = await restockProduct(db, {
        productId: body.productId,
        addQuantity: body.quantity,
        unit: body.unit ?? null,
        ratePerDay,
      });
      return NextResponse.json({ ok: true, action });
    }

    await db.insert(pantryStock).values({
      label: body.label,
      baseQuantity: String(body.quantity),
      unit: body.unit ?? null,
      stockedAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ ok: true, action: "created" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
