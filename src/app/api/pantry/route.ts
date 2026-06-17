import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { categories, pantryItems } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, dbConfigured: false, items: [] });
  }
  try {
    const db = getDb();
    const items = await db
      .select({
        category: categories.name,
        quantity: pantryItems.quantity,
        unit: pantryItems.unit,
        lastBought: pantryItems.lastBought,
      })
      .from(pantryItems)
      .leftJoin(categories, eq(pantryItems.categoryId, categories.id))
      .orderBy(categories.name);
    return NextResponse.json({ ok: true, dbConfigured: true, items });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        dbConfigured: true,
        items: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
