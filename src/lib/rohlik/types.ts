// Diagnostics trace returned alongside import results so we can see exactly what
// the Rohlik MCP server replied (temporary aid while shapes are confirmed).
export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  isError: boolean;
  text: string | null; // raw content text (truncated)
  hasStructured: boolean;
  structured: string | null; // structuredContent, JSON-stringified (truncated)
}

export interface RohlikDebug {
  connected: boolean;
  toolNames: string[];
  historyTool: string | null;
  historyToolSchema?: unknown;
  history?: ToolTrace;
  detail?: ToolTrace;
  categoryTool?: string | null; // tool used to fetch product categories
  productSample?: string | null; // raw sample of a product record (to confirm shapes)
}
