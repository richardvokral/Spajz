import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

/** Migration tags defined in the repo (drizzle/meta/_journal.json). */
export function definedMigrations(): string[] {
  try {
    const file = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(file, "utf8")) as {
      entries?: { tag?: string }[];
    };
    return (journal.entries ?? [])
      .map((e) => e.tag)
      .filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (
    res &&
    typeof res === "object" &&
    "rows" in res &&
    Array.isArray((res as { rows: unknown }).rows)
  ) {
    return (res as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

/** Migrations Drizzle has actually applied (the drizzle.__drizzle_migrations table). */
export async function appliedMigrations(
  db: Db
): Promise<{ hash: string; createdAt: number }[]> {
  try {
    const res = await db.execute(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
    );
    return rowsOf(res).map((r) => ({
      hash: String(r.hash ?? ""),
      createdAt: Number(r.created_at ?? 0),
    }));
  } catch {
    // table absent before the first migration
    return [];
  }
}
