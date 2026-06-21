import { NextResponse } from "next/server";
import { desc, ilike } from "drizzle-orm";
import { getDb, isDbConfigured } from "@/lib/db";
import { products } from "@/lib/schema";

export const runtime = "nodejs";

// GET ?q= — product picker for the "add from my items" pantry flow.
export async function GET(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: true, products: [] });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ ok: true, products: [] });

  try {
    const db = getDb();
    const rows = await db
      .select({ id: products.id, name: products.name, unit: products.unit })
      .from(products)
      .where(ilike(products.name, `%${q}%`))
      .orderBy(desc(products.lastSeenAt))
      .limit(20);
    return NextResponse.json({ ok: true, products: rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
