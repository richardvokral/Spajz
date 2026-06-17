import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // `db:generate` works offline; only `db:migrate` actually connects.
    url: process.env.DATABASE_URL ?? "postgres://placeholder/spajz",
  },
});
