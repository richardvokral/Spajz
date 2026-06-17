import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  categories,
  orderItems,
  orders,
  pantryItems,
  priceHistory,
  products,
} from "@/lib/schema";
import type { NormalizedOrder } from "@/lib/rohlik/mcp";
import { getSettings } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { categorizeProducts } from "@/lib/ai/categorize";

type Db = ReturnType<typeof getDb>;

export interface IngestResult {
  ordersSeen: number;
  ordersImported: number;
  itemsImported: number;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "category"
  );
}

async function ensureCategory(db: Db, name: string): Promise<string> {
  const slug = slugify(name);
  const inserted = await db
    .insert(categories)
    .values({ name, slug })
    .onConflictDoNothing({ target: categories.slug })
    .returning({ id: categories.id });
  if (inserted[0]) return inserted[0].id;
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug));
  return existing[0].id;
}

/**
 * Persist normalized orders into Neon. Idempotent: orders already present are
 * skipped; price history dedups on (product, order); the pantry is recomputed
 * from scratch at the end, so partial failures and re-imports converge.
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

  if (newOrders.length > 0) {
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
          set: { name: p.name, unit: p.unit, lastSeenAt: new Date(), updatedAt: new Date() },
        });
    }

    // 3. Resolve product uuids + categories.
    const pids = [...productMap.keys()];
    let productRows = pids.length
      ? await db
          .select({
            id: products.id,
            rohlikProductId: products.rohlikProductId,
            name: products.name,
            categoryId: products.categoryId,
          })
          .from(products)
          .where(inArray(products.rohlikProductId, pids))
      : [];

    // 4. AI categorization for products without a category (optional).
    const settings = await getSettings();
    if (settings.aiCategorizationEnabled && isAiConfigured()) {
      const uncategorized = productRows.filter((p) => !p.categoryId);
      if (uncategorized.length > 0) {
        const existingCats = await db
          .select({ name: categories.name })
          .from(categories);
        try {
          const map = await categorizeProducts(
            uncategorized.map((p) => p.name),
            existingCats.map((c) => c.name),
            settings.aiModel
          );
          for (const p of uncategorized) {
            const catName = map[p.name];
            if (catName) {
              const categoryId = await ensureCategory(db, catName);
              await db
                .update(products)
                .set({ categoryId, aiCategorized: true, updatedAt: new Date() })
                .where(eq(products.id, p.id));
            }
          }
          // refresh categories now assigned
          productRows = pids.length
            ? await db
                .select({
                  id: products.id,
                  rohlikProductId: products.rohlikProductId,
                  name: products.name,
                  categoryId: products.categoryId,
                })
                .from(products)
                .where(inArray(products.rohlikProductId, pids))
            : [];
        } catch {
          // categorization is best-effort; products stay uncategorized
        }
      }
    }

    const byRohlikId = new Map(productRows.map((p) => [p.rohlikProductId, p]));

    // 5. Insert each new order (with compensation on failure).
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
  }

  // 6. Recompute the category pantry from all order items (idempotent).
  await recomputePantry(db);
  return result;
}

async function recomputePantry(db: Db): Promise<void> {
  const uncategorizedId = await ensureCategory(db, "Uncategorized");

  const agg = await db
    .select({
      categoryId: products.categoryId,
      qty: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
      unit: sql<string | null>`max(${orderItems.unit})`,
      lastBought: sql<string | null>`max(${orders.orderedAt})`,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .leftJoin(orders, eq(orderItems.orderId, orders.id))
    .groupBy(products.categoryId);

  // Merge the null-category group into "Uncategorized".
  const merged = new Map<
    string,
    { qty: number; unit: string | null; lastBought: Date | null }
  >();
  for (const row of agg) {
    const catId = row.categoryId ?? uncategorizedId;
    const prev = merged.get(catId);
    const qty = (prev?.qty ?? 0) + Number(row.qty ?? 0);
    const lb = row.lastBought ? new Date(row.lastBought) : null;
    const lastBought =
      prev?.lastBought && lb
        ? prev.lastBought > lb
          ? prev.lastBought
          : lb
        : (prev?.lastBought ?? lb);
    merged.set(catId, { qty, unit: prev?.unit ?? row.unit, lastBought });
  }

  await db.delete(pantryItems);
  if (merged.size > 0) {
    await db.insert(pantryItems).values(
      [...merged.entries()].map(([categoryId, v]) => ({
        categoryId,
        quantity: String(v.qty),
        unit: v.unit,
        lastBought: v.lastBought,
        updatedAt: new Date(),
      }))
    );
  }
}
