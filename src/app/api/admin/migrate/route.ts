import { NextResponse } from "next/server";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getDb, isDbConfigured } from "@/lib/db";
import { appliedMigrations, definedMigrations } from "@/lib/migrations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not set." },
      { status: 500 }
    );
  }
  const db = getDb();
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    return NextResponse.json({
      ok: true,
      appliedMigrations: await appliedMigrations(db),
      definedMigrations: definedMigrations(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
