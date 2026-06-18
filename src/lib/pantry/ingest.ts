import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orderItems, orders, priceHistory, products } from "@/lib/schema";
import type { NormalizedOrder } from "@/lib/rohlik/mcp";

export interface IngestResult {
  ordersSeen: number;
  ordersImported: number;
  itemsImported: number;
}

/**
 * Persist normalized orders into Neon (products, orders, line items, price
 * history). Persist-only — categorization and the pantry are computed
 * separately. Idempotent: orders already present are skipped, price history
 * dedups on (product, order), and a partial order is rolled back so a re-run
 * retries it.
 */
export async function ingestOrders(
  ordersIn: NormalizedOrder[]
): Promise<IngestResult> {
  const db = getDb();
  const result: IngestResult = {
    ordersSeen: ordersIn.length,
    ordersImported: 0,
    itemsImported: 0,
  };
  if (ordersIn.length === 0) return result;

  // 1. Which orders are new?
  const incomingIds = ordersIn.map((o) => o.rohlikOrderId);
  const existing = await db
    .select({ id: orders.rohlikOrderId })
    .from(orders)
    .where(inArray(orders.rohlikOrderId, incomingIds));
  const existingSet = new Set(existing.map((e) => e.id));
  const newOrders = ordersIn.filter((o) => !existingSet.has(o.rohlikOrderId));
  if (newOrders.length === 0) return result;

  // 2. Upsert products seen across the new orders.
  const productMap = new Map<string, { name: string; unit: string | null }>();
  for (const o of newOrders) {
    for (const it of o.items) {
      if (it.rohlikProductId) {
        productMap.set(it.rohlikProductId, { name: it.name, unit: it.unit });
      }
    }
  }
  for (const [pid, p] of productMap) {
    await db
      .insert(products)
      .values({ rohlikProductId: pid, name: p.name, unit: p.unit })
      .onConflictDoUpdate({
        target: products.rohlikProductId,
        set: {
          name: p.name,
          unit: p.unit,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  // 3. Resolve product uuids.
  const pids = [...productMap.keys()];
  const productRows = pids.length
    ? await db
        .select({ id: products.id, rohlikProductId: products.rohlikProductId })
        .from(products)
        .where(inArray(products.rohlikProductId, pids))
    : [];
  const byRohlikId = new Map(productRows.map((p) => [p.rohlikProductId, p]));

  // 4. Insert each new order (with compensation on failure).
  for (const o of newOrders) {
    try {
      const inserted = await db
        .insert(orders)
        .values({
          rohlikOrderId: o.rohlikOrderId,
          orderedAt: o.orderedAt ? new Date(o.orderedAt) : null,
          total: o.total != null ? String(o.total) : null,
          currency: o.currency,
          state: o.state,
          itemsCount: o.itemsCount,
          raw: o.raw,
        })
        .returning({ id: orders.id });
      const orderId = inserted[0].id;

      for (const it of o.items) {
        const product = it.rohlikProductId
          ? byRohlikId.get(it.rohlikProductId)
          : undefined;
        await db.insert(orderItems).values({
          orderId,
          productId: product?.id ?? null,
          name: it.name,
          quantity: String(it.quantity),
          unit: it.unit,
          textualAmount: it.textualAmount,
          price: it.price != null ? String(it.price) : null,
          currency: it.currency,
        });
        if (product) {
          await db
            .insert(priceHistory)
            .values({
              productId: product.id,
              price: it.price != null ? String(it.price) : null,
              currency: it.currency,
              observedAt: o.orderedAt ? new Date(o.orderedAt) : null,
              rohlikOrderId: o.rohlikOrderId,
            })
            .onConflictDoNothing();
        }
      }
      result.ordersImported += 1;
      result.itemsImported += o.items.length;
    } catch (err) {
      // remove the partial order (cascades to its items) so a re-run retries it
      await db
        .delete(orders)
        .where(eq(orders.rohlikOrderId, o.rohlikOrderId))
        .catch(() => {});
      throw err instanceof Error
        ? new Error(`Order ${o.rohlikOrderId}: ${err.message}`)
        : err;
    }
  }

  return result;
}
