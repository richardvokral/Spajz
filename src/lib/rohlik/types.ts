// Shared types for Rohlik order data flowing from the MCP server to the UI.

export interface OrderLineItem {
  productId: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  price: number | null; // CZK, unit or line price as reported by Rohlik
}

export interface LastOrder {
  orderId: string;
  orderedAt: string | null; // ISO date if Rohlik provides one
  items: OrderLineItem[];
}

// Discriminated response returned by the /api/rohlik/last-order route.
export type LastOrderResponse =
  | { ok: true; order: LastOrder }
  | { ok: false; error: string };
