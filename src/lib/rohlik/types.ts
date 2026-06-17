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

// Diagnostic trace returned alongside the result so we can see exactly what the
// Rohlik MCP server replied (temporary aid while the real shapes are unknown).
export interface ToolTrace {
  tool: string;
  isError: boolean;
  text: string | null; // raw content text (truncated)
  hasStructured: boolean;
}

export interface RohlikDebug {
  connected: boolean;
  toolNames: string[];
  historyTool: string | null;
  history?: ToolTrace;
  detail?: ToolTrace;
}

// Discriminated response returned by the /api/rohlik/last-order route.
export type LastOrderResponse =
  | { ok: true; order: LastOrder; debug: RohlikDebug }
  | { ok: false; error: string; debug: RohlikDebug };
