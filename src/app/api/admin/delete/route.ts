import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import {
  categories,
  orderItems,
  orders,
  pantryItems,
  priceHistory,
  products,
} from "@/lib/schema";

export const runtime = "nodejs";

const Body = z.object({ what: z.enum(["orders", "all"]) });

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not set." },
      { status: 500 }
    );
  }
  let what: "orders" | "all";
  try {
    what = Body.parse(await req.json()).what;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const db = getDb();
  try {
    // orderItems + priceHistory cascade from orders/products, but delete
    // explicitly so this works regardless of cascade timing.
    await db.delete(pantryItems);
    await db.delete(orderItems);
    await db.delete(priceHistory);
    await db.delete(orders);
    if (what === "all") {
      await db.delete(products);
      await db.delete(categories);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
