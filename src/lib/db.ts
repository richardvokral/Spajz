// Neon + Drizzle connection. Scaffold only — the MVP never calls this.
// Lazily constructed so importing the module never crashes when DATABASE_URL
// is absent (e.g. local dev without a database).

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}
