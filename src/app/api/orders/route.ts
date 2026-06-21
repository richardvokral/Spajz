import { NextResponse } from "next/server";
import { desc, isNotNull } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { orders } from "@/lib/schema";

export const runtime = "nodejs";

// GET — recent orders for the "add a specific purchase" pantry flow.
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, orders: [] });
  }
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: orders.id,
        orderedAt: orders.orderedAt,
        itemsCount: orders.itemsCount,
        total: orders.total,
        currency: orders.currency,
      })
      .from(orders)
      .where(isNotNull(orders.orderedAt))
      .orderBy(desc(orders.orderedAt))
      .limit(20);
    return NextResponse.json({ ok: true, orders: rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
