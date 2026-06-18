// Neon + Drizzle connection. Lazily constructed so importing the module never
// crashes when DATABASE_URL is absent.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

/** Normalize a `db.execute()` result to a rows array (neon-http returns an
 * array or `{ rows }` depending on the statement). */
export function rowsOf(res: unknown): Record<string, unknown>[] {
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
