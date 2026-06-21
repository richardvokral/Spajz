import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { orderItems, orders } from "@/lib/schema";
import { computeRates, restockProduct } from "@/lib/pantry/stock";

export const runtime = "nodejs";

const Body = z.object({
  orderId: z.union([z.literal("last"), z.string().uuid()]),
});

// POST — add every matched line of an order onto the pantry (current estimate +
// purchased qty, decay clock reset). "last" picks the most recent order.
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

    const orderRow =
      body.orderId === "last"
        ? (
            await db
              .select({ id: orders.id })
              .from(orders)
              .where(isNotNull(orders.orderedAt))
              .orderBy(desc(orders.orderedAt))
              .limit(1)
          )[0]
        : (
            await db
              .select({ id: orders.id })
              .from(orders)
              .where(eq(orders.id, body.orderId))
              .limit(1)
          )[0];

    if (!orderRow) {
      return NextResponse.json(
        { ok: false, error: "No order found to stock from. Import an order first." },
        { status: 404 }
      );
    }

    const lines = await db
      .select({
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        unit: orderItems.unit,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderRow.id));

    // Aggregate by product so a product appearing on multiple lines is added once.
    const byProduct = new Map<string, { qty: number; unit: string | null }>();
    let skipped = 0;
    for (const l of lines) {
      if (!l.productId) {
        skipped += 1;
        continue;
      }
      const cur = byProduct.get(l.productId) ?? { qty: 0, unit: l.unit ?? null };
      cur.qty += Number(l.quantity ?? 0);
      byProduct.set(l.productId, cur);
    }

    const rates = await computeRates(db);
    const now = new Date();
    let restocked = 0;
    let created = 0;
    for (const [productId, info] of byProduct) {
      const action = await restockProduct(db, {
        productId,
        addQuantity: info.qty,
        unit: info.unit,
        ratePerDay: rates.get(productId)?.ratePerDay ?? 0,
        now,
      });
      if (action === "created") created += 1;
      else restocked += 1;
    }

    return NextResponse.json({
      ok: true,
      orderId: orderRow.id,
      restocked,
      created,
      skipped,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
