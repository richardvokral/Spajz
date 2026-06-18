import { callStructuredTool } from "./client";

export interface CategorizeItem {
  name: string;
  hint?: string; // e.g. the Rohlik (MCP) category, to disambiguate
}

const CHUNK = 60;

/**
 * Classifies grocery products into short, generic pantry categories. Returns an
 * array aligned BY INDEX with `items` (category string or null). Matching is by
 * index, not by name, so a paraphrased product name never drops a result.
 */
export async function categorizeProducts(
  items: CategorizeItem[],
  existingCategories: string[],
  model: string
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(items.length).fill(null);
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const result = await categorizeChunk(chunk, existingCategories, model);
    for (const r of result) {
      if (r.index >= 0 && r.index < chunk.length && r.category) {
        out[start + r.index] = r.category.trim();
      }
    }
  }
  return out;
}

async function categorizeChunk(
  items: CategorizeItem[],
  existingCategories: string[],
  model: string
): Promise<{ index: number; category: string }[]> {
  const result = await callStructuredTool<{
    categories?: { index: number; category: string }[];
  }>({
    model,
    maxTokens: 2000,
    system:
      "You group grocery products into a small set of generic pantry categories. " +
      "A category is the kind of food, ignoring brand, variety, or packaging — " +
      'e.g. "Schubert BIO Natur vejce M" and "Farmářská vejce" are both "Eggs". ' +
      "Use short English category names in Title Case (Eggs, Milk, Cucumber, " +
      "Tomatoes, Beer, Wine, Flour, Cheese). Reuse an existing category whenever " +
      "it fits rather than inventing a near-duplicate. If a Rohlik category hint " +
      "is given you may use it to disambiguate, but still output your own generic " +
      "category.",
    prompt:
      (existingCategories.length
        ? `Existing categories to reuse when they fit:\n${existingCategories.join(", ")}\n\n`
        : "") +
      `Assign a category to each product by index:\n${items
        .map(
          (it, i) =>
            `${i}. ${it.name}${it.hint ? ` (Rohlik category: ${it.hint})` : ""}`
        )
        .join("\n")}`,
    toolName: "submit_categories",
    toolDescription: "Return the category for each product, keyed by its index.",
    inputSchema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer", description: "The product's index" },
              category: { type: "string", description: "Generic category" },
            },
            required: ["index", "category"],
          },
        },
      },
      required: ["categories"],
    },
  });
  return (result.categories ?? []).filter(
    (c) => typeof c?.index === "number" && typeof c?.category === "string"
  );
}
