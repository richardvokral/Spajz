import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { pantryStock } from "@/lib/schema";
import { computeRates, project } from "@/lib/pantry/stock";

export const runtime = "nodejs";

// PATCH — adjust quantity, override the consumption rate, and/or toggle the
// "needed" heart. A quantity/rate change re-anchors the row (base + stockedAt=now)
// so the displayed remaining stays predictable; a heart toggle does not.
const Body = z
  .object({
    quantity: z.number().nonnegative().optional(),
    ratePerWeek: z.number().nonnegative().nullable().optional(),
    needed: z.boolean().optional(),
  })
  .refine(
    (b) => b.quantity !== undefined || b.ratePerWeek !== undefined || b.needed !== undefined,
    { message: "Nothing to update." }
  );

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const db = getDb();
    const rows = await db
      .select({
        productId: pantryStock.productId,
        baseQuantity: pantryStock.baseQuantity,
        stockedAt: pantryStock.stockedAt,
        manualRatePerDay: pantryStock.manualRatePerDay,
      })
      .from(pantryStock)
      .where(eq(pantryStock.id, id));
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
    }

    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };
    if (body.needed !== undefined) set.needed = body.needed;

    const reAnchor = body.quantity !== undefined || body.ratePerWeek !== undefined;
    if (reAnchor) {
      // Rate in effect before this edit, used to compute the current remaining.
      const historyRate = row.productId
        ? (await computeRates(db)).get(row.productId)?.ratePerDay ?? 0
        : 0;
      const prevRate = row.manualRatePerDay != null ? Number(row.manualRatePerDay) : historyRate;
      const { remaining } = project(
        Number(row.baseQuantity ?? 0),
        new Date(row.stockedAt),
        prevRate,
        now
      );

      set.baseQuantity = String(body.quantity ?? remaining);
      set.stockedAt = now;
      if (body.ratePerWeek !== undefined) {
        set.manualRatePerDay = body.ratePerWeek === null ? null : String(body.ratePerWeek / 7);
      }
    }

    await db.update(pantryStock).set(set).where(eq(pantryStock.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set." }, { status: 500 });
  }
  try {
    const { id } = await params;
    const db = getDb();
    await db.delete(pantryStock).where(eq(pantryStock.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
