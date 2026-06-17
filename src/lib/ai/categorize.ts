import { callStructuredTool } from "./client";

export interface ProductCategory {
  name: string; // the product name we sent
  category: string; // assigned generic category, e.g. "Eggs"
}

/**
 * Classifies grocery product names into short, generic pantry categories.
 * Reuses an existing category when one fits (to avoid fragmentation).
 */
export async function categorizeProducts(
  names: string[],
  existingCategories: string[],
  model: string
): Promise<Record<string, string>> {
  if (names.length === 0) return {};

  const result = await callStructuredTool<{ items?: ProductCategory[] }>({
    model,
    maxTokens: 1500,
    system:
      "You group grocery products into a small set of generic pantry categories. " +
      "A category is the kind of food, ignoring brand, variety, or packaging — " +
      'e.g. "Schubert BIO Natur vejce M" and "Farmářská vejce" are both "Eggs". ' +
      "Use short English category names in Title Case (Eggs, Milk, Cucumber, " +
      "Tomatoes, Beer, Wine, Flour, Cheese). Reuse an existing category whenever " +
      "it fits rather than inventing a near-duplicate.",
    prompt:
      (existingCategories.length
        ? `Existing categories to reuse when they fit:\n${existingCategories.join(", ")}\n\n`
        : "") +
      `Assign a category to each product:\n${names
        .map((n, i) => `${i + 1}. ${n}`)
        .join("\n")}`,
    toolName: "submit_categories",
    toolDescription: "Return the category for each product name.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "The product name, verbatim" },
              category: { type: "string", description: "Generic category" },
            },
            required: ["name", "category"],
          },
        },
      },
      required: ["items"],
    },
  });

  const map: Record<string, string> = {};
  for (const item of result.items ?? []) {
    if (item?.name && item?.category) {
      map[item.name] = item.category.trim();
    }
  }
  return map;
}
