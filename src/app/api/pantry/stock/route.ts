import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { pantryStock, products } from "@/lib/schema";
import { computeRates, contentFor, project, restockProduct } from "@/lib/pantry/stock";

export const runtime = "nodejs";

// GET — list pantry stock with on-read remaining, weekly rate and days-until-empty,
// sorted by urgency (soonest-empty first; rows with no rate last).
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, dbConfigured: false, items: [] });
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
        stockedAt: pantryStock.stockedAt,
        productName: products.name,
        productUnit: products.unit,
      })
      .from(pantryStock)
      .leftJoin(products, eq(pantryStock.productId, products.id));

    const now = new Date();
    const items = rows.map((r) => {
      const rate = r.productId ? rates.get(r.productId) : undefined;
      const ratePerDay = rate?.ratePerDay ?? 0;
      const base = Number(r.baseQuantity ?? 0);
      const { remaining, daysUntilEmpty } = project(base, new Date(r.stockedAt), ratePerDay, now);
      const content = contentFor(remaining, rate?.textualAmount ?? null);
      return {
        id: r.id,
        productId: r.productId,
        name: r.productName ?? r.label ?? "Unknown item",
        unit: r.unit ?? r.productUnit ?? null,
        baseQuantity: base,
        remaining: Math.round(remaining * 100) / 100,
        remainingContent: content?.amount ?? null,
        contentUnit: content?.unit ?? null,
        ratePerWeek: Math.round(ratePerDay * 7 * 100) / 100,
        daysUntilEmpty: daysUntilEmpty != null ? Math.round(daysUntilEmpty) : null,
        stockedAt: r.stockedAt,
        lastBought: rate?.lastBought ?? null,
      };
    });

    items.sort((a, b) => {
      if (a.daysUntilEmpty == null && b.daysUntilEmpty == null)
        return a.name.localeCompare(b.name);
      if (a.daysUntilEmpty == null) return 1;
      if (b.daysUntilEmpty == null) return -1;
      return a.daysUntilEmpty - b.daysUntilEmpty;
    });

    return NextResponse.json({ ok: true, dbConfigured: true, items });
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
