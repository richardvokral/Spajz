import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { getDb } from "@/lib/db";
import { categories, products } from "@/lib/schema";
import { fetchProductCategories, MCP_CATEGORY_MAX } from "@/lib/rohlik/mcp";
import { categorizeProducts } from "@/lib/ai/categorize";
import { isAiConfigured } from "@/lib/ai/client";
import type { AppSettings } from "@/lib/settings";

type Db = ReturnType<typeof getDb>;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "category"
  );
}

export async function ensureCategory(db: Db, name: string): Promise<string> {
  const slug = slugify(name);
  const inserted = await db
    .insert(categories)
    .values({ name, slug })
    .onConflictDoNothing({ target: categories.slug })
    .returning({ id: categories.id });
  if (inserted[0]) return inserted[0].id;
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug));
  return existing[0].id;
}

export interface CategorizeResult {
  mcpFetched: number;
  aiCategorized: number;
  fallbackCategorized: number;
  errors: string[];
  debugSample?: string | null;
}

/**
 * Resolves product categories in three best-effort passes: (1) Rohlik's own
 * category via MCP, (2) an AI generic category (using the Rohlik category as a
 * hint), (3) fallback to the Rohlik category when AI left it unset. Each pass
 * collects errors rather than throwing.
 */
export async function runCategorization(opts: {
  db: Db;
  authProvider?: OAuthClientProvider;
  settings: AppSettings;
}): Promise<CategorizeResult> {
  const { db, authProvider, settings } = opts;
  const result: CategorizeResult = {
    mcpFetched: 0,
    aiCategorized: 0,
    fallbackCategorized: 0,
    errors: [],
  };

  // 1. Rohlik (MCP) categories for products missing one.
  if (authProvider) {
    try {
      const rows = await db
        .select({ id: products.id, rohlikProductId: products.rohlikProductId })
        .from(products)
        .where(isNull(products.mcpCategory))
        .orderBy(desc(products.lastSeenAt))
        .limit(MCP_CATEGORY_MAX);
      const ids = rows.map((r) => r.rohlikProductId);
      if (ids.length > 0) {
        const { map, debug } = await fetchProductCategories(authProvider, ids);
        result.debugSample = debug.productSample ?? null;
        for (const r of rows) {
          const cat = map[r.rohlikProductId];
          if (cat) {
            await db
              .update(products)
              .set({
                mcpCategory: cat.category,
                mcpCategoryPath: cat.path,
                updatedAt: new Date(),
              })
              .where(eq(products.id, r.id));
            result.mcpFetched += 1;
          }
        }
      }
    } catch (e) {
      result.errors.push(`mcp: ${msg(e)}`);
    }
  }

  // 2. AI generic category for products without one (Rohlik category as hint).
  if (settings.aiCategorizationEnabled && isAiConfigured()) {
    try {
      const rows = await db
        .select({
          id: products.id,
          name: products.name,
          mcpCategory: products.mcpCategory,
        })
        .from(products)
        .where(isNull(products.categoryId));
      if (rows.length > 0) {
        const existing = (
          await db.select({ name: categories.name }).from(categories)
        ).map((c) => c.name);
        const cats = await categorizeProducts(
          rows.map((r) => ({ name: r.name, hint: r.mcpCategory ?? undefined })),
          existing,
          settings.aiModel
        );
        for (let i = 0; i < rows.length; i++) {
          const cat = cats[i];
          if (cat) {
            const categoryId = await ensureCategory(db, cat);
            await db
              .update(products)
              .set({ categoryId, aiCategorized: true, updatedAt: new Date() })
              .where(eq(products.id, rows[i].id));
            result.aiCategorized += 1;
          }
        }
      }
    } catch (e) {
      result.errors.push(`ai: ${msg(e)}`);
    }
  }

  // 3. Fallback to the Rohlik category when still uncategorized.
  try {
    const rows = await db
      .select({ id: products.id, mcpCategory: products.mcpCategory })
      .from(products)
      .where(and(isNull(products.categoryId), isNotNull(products.mcpCategory)));
    for (const r of rows) {
      if (r.mcpCategory) {
        const categoryId = await ensureCategory(db, r.mcpCategory);
        await db
          .update(products)
          .set({ categoryId, updatedAt: new Date() })
          .where(eq(products.id, r.id));
        result.fallbackCategorized += 1;
      }
    }
  } catch (e) {
    result.errors.push(`fallback: ${msg(e)}`);
  }

  return result;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
