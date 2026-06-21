// Phase 3b pantry-stock math, shared by the stock/restock/cron routes.
//
// Purchase history is the consumption signal: how much of a product you buy over
// the last 6 months is how fast you use it. We anchor a stocked quantity at a
// point in time and decay it by that rate, so "remaining" is a pure function of
// (base, stockedAt, rate, now) — recomputed on read, no nightly job required.
//
// Note: the rate comes from a *sliding* 6-month window, so the same row can yield
// a different `remaining` after a new import. That's intended (estimates improve
// with data) — do not "fix" it by caching the rate on the row.

import { eq, sql } from "drizzle-orm";
import { getDb, rowsOf } from "@/lib/db";
import { pantryStock } from "@/lib/schema";
import { parseTextualAmount, type ContentUnit } from "@/lib/pantry/parseAmount";

type Db = ReturnType<typeof getDb>;

const DAY_MS = 86_400_000;

// Floor on the consumption window so a product first seen a few days ago doesn't
// read as an impossibly fast (divide-by-tiny) rate.
export const MIN_DENOMINATOR_DAYS = 14;

export interface ProductRate {
  ratePerDay: number; // packages/day, averaged over the last 6 months
  qty6m: number;
  orderCount: number;
  textualAmount: string | null;
  lastBought: string | null;
}

/** Per-product consumption rate from the last 6 months of orders. */
export async function computeRates(db: Db): Promise<Map<string, ProductRate>> {
  const rows = rowsOf(
    await db.execute(sql`
      select oi.product_id as product_id,
             coalesce(sum(oi.quantity::numeric), 0)::float8 as qty_6m,
             count(distinct oi.order_id)::int as order_count,
             min(o.ordered_at) as first_purchase,
             max(o.ordered_at) as last_purchase,
             max(oi.textual_amount) as textual_amount
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.product_id is not null
        and o.ordered_at is not null
        and o.ordered_at >= now() - interval '6 months'
      group by oi.product_id
    `)
  );

  const now = Date.now();
  const map = new Map<string, ProductRate>();
  for (const r of rows) {
    const qty6m = Number(r.qty_6m ?? 0);
    const first = r.first_purchase
      ? new Date(r.first_purchase as string).getTime()
      : now;
    const spanDays = (now - first) / DAY_MS;
    const denom = Math.max(spanDays, MIN_DENOMINATOR_DAYS);
    map.set(String(r.product_id), {
      ratePerDay: denom > 0 ? qty6m / denom : 0,
      qty6m,
      orderCount: Number(r.order_count ?? 0),
      textualAmount: (r.textual_amount as string | null) ?? null,
      lastBought: (r.last_purchase as string | null) ?? null,
    });
  }
  return map;
}

export interface Projection {
  remaining: number;
  daysUntilEmpty: number | null;
}

/** Decay a stocked quantity by its consumption rate up to `now`. Pure. */
export function project(
  baseQuantity: number,
  stockedAt: Date,
  ratePerDay: number,
  now: Date = new Date()
): Projection {
  const days = Math.max(0, (now.getTime() - stockedAt.getTime()) / DAY_MS);
  const remaining = Math.max(0, baseQuantity - ratePerDay * days);
  return { remaining, daysUntilEmpty: ratePerDay > 0 ? remaining / ratePerDay : null };
}

/** Content amount (g/ml/pcs) for a number of packages, using the product's
 * parsed textual size. Null when the size can't be parsed. */
export function contentFor(
  packages: number,
  textualAmount: string | null
): { amount: number; unit: ContentUnit } | null {
  const parsed = parseTextualAmount(textualAmount);
  if (!parsed) return null;
  return {
    amount: Math.round(packages * parsed.amount * 100) / 100,
    unit: parsed.unit,
  };
}

/**
 * Add `addQuantity` packages to a product's stock on top of whatever is estimated
 * left, and re-anchor the decay clock to `now`. Used by both the manual product
 * add and "stock from last purchase". Returns whether a row was created or updated.
 */
export async function restockProduct(
  db: Db,
  opts: {
    productId: string;
    addQuantity: number;
    unit: string | null;
    ratePerDay: number;
    now?: Date;
  }
): Promise<"created" | "updated"> {
  const now = opts.now ?? new Date();
  const existing = await db
    .select({
      baseQuantity: pantryStock.baseQuantity,
      stockedAt: pantryStock.stockedAt,
      unit: pantryStock.unit,
      manualRatePerDay: pantryStock.manualRatePerDay,
    })
    .from(pantryStock)
    .where(eq(pantryStock.productId, opts.productId));
  const prev = existing[0];

  let newBase = opts.addQuantity;
  if (prev) {
    // A manual rate override (kept on restock) takes precedence over history.
    const effectiveRate =
      prev.manualRatePerDay != null ? Number(prev.manualRatePerDay) : opts.ratePerDay;
    const { remaining } = project(
      Number(prev.baseQuantity ?? 0),
      new Date(prev.stockedAt),
      effectiveRate,
      now
    );
    newBase = remaining + opts.addQuantity;
  }

  const unit = opts.unit ?? prev?.unit ?? null;
  await db
    .insert(pantryStock)
    .values({
      productId: opts.productId,
      baseQuantity: String(newBase),
      unit,
      stockedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pantryStock.productId,
      set: { baseQuantity: String(newBase), unit, stockedAt: now, updatedAt: now },
    });

  return prev ? "updated" : "created";
}
