import { NextResponse } from "next/server";
import { getDb, isDbConfigured } from "@/lib/db";
import { pantrySnapshots, pantryStock } from "@/lib/schema";
import { getSettings } from "@/lib/settings";
import { computeRates, project } from "@/lib/pantry/stock";

export const runtime = "nodejs";

// POST — record one snapshot row per stock item of the current computed remaining.
// Prepared for a daily cron/webhook; the live pantry never reads these rows.
// Guarded by CRON_SECRET (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`)
// and gated by the admin toggle `pantrySnapshotEnabled` (off by default).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set." }, { status: 500 });
  }

  try {
    const settings = await getSettings();
    if (!settings.pantrySnapshotEnabled) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const db = getDb();
    const rates = await computeRates(db);
    const rows = await db
      .select({
        productId: pantryStock.productId,
        label: pantryStock.label,
        baseQuantity: pantryStock.baseQuantity,
        stockedAt: pantryStock.stockedAt,
      })
      .from(pantryStock);

    const now = new Date();
    const snapshot = rows.map((r) => {
      const ratePerDay = r.productId ? rates.get(r.productId)?.ratePerDay ?? 0 : 0;
      const { remaining } = project(
        Number(r.baseQuantity ?? 0),
        new Date(r.stockedAt),
        ratePerDay,
        now
      );
      return {
        productId: r.productId,
        label: r.label,
        remainingPackages: String(Math.round(remaining * 100) / 100),
        snapshotDate: now,
      };
    });

    if (snapshot.length > 0) await db.insert(pantrySnapshots).values(snapshot);
    return NextResponse.json({ ok: true, written: snapshot.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
