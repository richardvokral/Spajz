import { callStructuredTool } from "./client";

/**
 * Best-effort AI extraction of orders from an unexpected Rohlik response body.
 * Returns a `{ orders: [...] }` payload that the deterministic normalizer can
 * then consume, or null on failure. Used only when deterministic parsing finds
 * no orders and the admin toggle is on.
 */
export async function aiExtractOrders(
  rawText: string,
  model: string
): Promise<unknown | null> {
  try {
    const result = await callStructuredTool<{ orders?: unknown[] }>({
      model,
      maxTokens: 4000,
      system:
        "You extract grocery order data from a raw JSON or text blob returned by " +
        "the Rohlik API. Return the orders you can find with their line items.",
      prompt: `Extract orders from this response:\n\n${rawText.slice(0, 60000)}`,
      toolName: "submit_orders",
      toolDescription: "Return the extracted orders and their line items.",
      inputSchema: {
        type: "object",
        properties: {
          orders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Order id" },
                orderTime: { type: "string", description: "ISO date/time" },
                state: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "Product id" },
                      name: { type: "string" },
                      unit: { type: "string" },
                      textualAmount: { type: "string" },
                      totalPrice: { type: "number" },
                    },
                    required: ["name"],
                  },
                },
              },
              required: ["id"],
            },
          },
        },
        required: ["orders"],
      },
    });
    return result;
  } catch {
    return null;
  }
}
