import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isDbConfigured, rowsOf } from "@/lib/db";

export const runtime = "nodejs";

const WEEKDAYS = [
  { dow: 1, day: "Mon" },
  { dow: 2, day: "Tue" },
  { dow: 3, day: "Wed" },
  { dow: 4, day: "Thu" },
  { dow: 5, day: "Fri" },
  { dow: 6, day: "Sat" },
  { dow: 0, day: "Sun" },
];

function emptyPayload() {
  return {
    ok: true as const,
    dbConfigured: false,
    currency: "CZK",
    monthly: [] as { month: string; label: string; total: number; count: number }[],
    avgOrderValue: 0,
    totalOrders: 0,
    totalSpent: 0,
    favouriteDay: null as { day: string; count: number } | null,
    byWeekday: [] as { day: string; count: number }[],
  };
}

export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json(emptyPayload());
  }

  try {
    const db = getDb();

    // Per-month totals/counts (we fill the 6 buckets in JS so charts are stable).
    const monthlyRows = rowsOf(
      await db.execute(sql`
        select to_char(date_trunc('month', ordered_at), 'YYYY-MM') as ym,
               count(*)::int as count,
               coalesce(sum(total::numeric), 0)::float8 as total
        from orders
        where ordered_at is not null
          and ordered_at >= date_trunc('month', now()) - interval '5 months'
        group by 1
      `)
    );
    const byMonth = new Map(
      monthlyRows.map((r) => [
        String(r.ym),
        { total: Number(r.total ?? 0), count: Number(r.count ?? 0) },
      ])
    );
    const now = new Date();
    const monthly = Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - k), 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const hit = byMonth.get(month);
      return {
        month,
        label: d.toLocaleString("en-US", { month: "short" }),
        total: hit?.total ?? 0,
        count: hit?.count ?? 0,
      };
    });

    // Headline figures over the whole period.
    const head = rowsOf(
      await db.execute(sql`
        select coalesce(avg(total::numeric), 0)::float8 as avg_order,
               count(*)::int as orders,
               coalesce(sum(total::numeric), 0)::float8 as spent,
               max(currency) as currency
        from orders
        where ordered_at is not null
      `)
    )[0];
    const avgOrderValue = Number(head?.avg_order ?? 0);
    const totalOrders = Number(head?.orders ?? 0);
    const totalSpent = Number(head?.spent ?? 0);
    const currency = (head?.currency as string) || "CZK";

    // Orders by weekday.
    const dowRows = rowsOf(
      await db.execute(sql`
        select extract(dow from ordered_at)::int as dow, count(*)::int as count
        from orders
        where ordered_at is not null
        group by 1
      `)
    );
    const byDow = new Map(dowRows.map((r) => [Number(r.dow), Number(r.count ?? 0)]));
    const byWeekday = WEEKDAYS.map((w) => ({ day: w.day, count: byDow.get(w.dow) ?? 0 }));
    const favouriteDay = byWeekday.reduce<{ day: string; count: number } | null>(
      (best, w) => (w.count > 0 && (!best || w.count > best.count) ? w : best),
      null
    );

    return NextResponse.json({
      ok: true,
      dbConfigured: true,
      currency,
      monthly,
      avgOrderValue,
      totalOrders,
      totalSpent,
      favouriteDay,
      byWeekday,
    });
  } catch (err) {
    return NextResponse.json(
      { ...emptyPayload(), dbConfigured: true, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
