import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  LastOrderResponse,
  OrderLineItem,
  RohlikDebug,
  ToolTrace,
} from "./types";

const ROHLIK_MCP_URL = "https://mcp.rohlik.cz/mcp";

export interface RohlikCredentials {
  email: string;
  password: string;
}

interface ToolInfo {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> };
}

/**
 * Connects to the Rohlik MCP server with the legacy header auth, reads the most
 * recent order and normalizes its line items. Returns a discriminated result
 * plus a diagnostics trace (so silent auth/format failures are visible instead
 * of collapsing into a misleading "no orders" message). Credentials are used
 * only for this call and are never persisted.
 */
export async function importLastOrder(
  creds: RohlikCredentials
): Promise<LastOrderResponse> {
  const debug: RohlikDebug = {
    connected: false,
    toolNames: [],
    historyTool: null,
  };

  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    requestInit: {
      headers: {
        "rhl-email": creds.email,
        "rhl-pass": creds.password,
      },
    },
  });

  const client = new Client(
    { name: "spajz", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    try {
      await client.connect(transport);
    } catch (err) {
      return {
        ok: false,
        error: `Could not connect to Rohlik (this usually means wrong credentials or an OAuth-only endpoint): ${msg(err)}`,
        debug,
      };
    }
    debug.connected = true;

    let tools: ToolInfo[] = [];
    try {
      const listed = await client.listTools();
      tools = (listed.tools ?? []) as ToolInfo[];
      debug.toolNames = tools.map((t) => t.name);
    } catch {
      // Listing failed but we can still try the conventional tool name.
    }

    const historyTool =
      pickTool(tools, ["get_order_history", "order_history", "get_orders"], [
        "history",
        "order",
      ]) ?? "get_order_history";
    debug.historyTool = historyTool;

    const historyRaw = await callTool(client, historyTool, {});
    debug.history = trace(historyTool, historyRaw);
    if (isToolError(historyRaw)) {
      return {
        ok: false,
        error: `Rohlik returned an error from "${historyTool}": ${textOf(historyRaw) ?? "(no message)"}`,
        debug,
      };
    }

    const orders = normalizeOrderList(extractData(historyRaw));
    if (orders.length === 0) {
      return {
        ok: false,
        error:
          "Connected, but no orders could be read from the history response. This is most often an authentication problem (wrong Rohlik password, or a pending new-login confirmation email), or an unexpected response format. Expand Diagnostics to see what Rohlik actually returned.",
        debug,
      };
    }

    const latest = pickLatest(orders);

    // Some history endpoints already embed line items; use them if present.
    let items = normalizeLineItems(latest.raw);

    if (items.length === 0) {
      const detailTool = pickTool(
        tools,
        ["get_order_detail", "order_detail"],
        ["detail"]
      );
      if (detailTool) {
        const tool = tools.find((t) => t.name === detailTool);
        const detailRaw = await callTool(client, detailTool, {
          [idArgName(tool)]: latest.orderId,
        });
        debug.detail = trace(detailTool, detailRaw);
        if (!isToolError(detailRaw)) {
          items = normalizeLineItems(extractData(detailRaw));
        }
      }
    }

    return {
      ok: true,
      order: { orderId: latest.orderId, orderedAt: latest.orderedAt, items },
      debug,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

// --- MCP result helpers ---

type ToolResult = {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
};

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function isToolError(result: ToolResult): boolean {
  return result.isError === true;
}

function textOf(result: ToolResult): string | null {
  const content = result.content;
  if (Array.isArray(content)) {
    const parts = content
      .filter(
        (c): c is { type: string; text: string } =>
          c?.type === "text" && typeof c?.text === "string"
      )
      .map((c) => c.text);
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}

function extractData(result: ToolResult): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const text = textOf(result);
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return { _text: text };
    }
  }
  return result;
}

function trace(tool: string, result: ToolResult): ToolTrace {
  const text = textOf(result);
  return {
    tool,
    isError: result.isError === true,
    text: text ? text.slice(0, 2000) : null,
    hasStructured:
      result.structuredContent !== undefined && result.structuredContent !== null,
  };
}

function pickTool(
  tools: ToolInfo[],
  exact: string[],
  contains: string[]
): string | null {
  if (tools.length === 0) return null;
  const names = tools.map((t) => t.name);
  for (const e of exact) if (names.includes(e)) return e;
  const lowered = contains.map((c) => c.toLowerCase());
  const match = names.find((n) =>
    lowered.every((c) => n.toLowerCase().includes(c))
  );
  return match ?? null;
}

function idArgName(tool: ToolInfo | undefined): string {
  const props = tool?.inputSchema?.properties;
  if (props) {
    for (const k of ["orderId", "order_id", "id", "orderNumber", "number"]) {
      if (k in props) return k;
    }
    const first = Object.keys(props)[0];
    if (first) return first;
  }
  return "orderId";
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Defensive normalization (exact Rohlik shape still unconfirmed) ---

interface RawOrder {
  orderId: string;
  orderedAt: string | null;
  raw: Record<string, unknown>;
}

function normalizeOrderList(data: unknown): RawOrder[] {
  return firstArray(data, ["orders", "items", "data", "history"])
    .map((o) => ({
      orderId: String(pick(o, ["id", "orderId", "order_id", "number"]) ?? ""),
      orderedAt: asIso(pick(o, ["orderedAt", "createdAt", "date", "created_at"])),
      raw: o,
    }))
    .filter((o) => o.orderId.length > 0);
}

function normalizeLineItems(data: unknown): OrderLineItem[] {
  return firstArray(data, ["items", "lineItems", "products", "data"]).map((it) => ({
    productId: optStr(pick(it, ["productId", "product_id", "id"])),
    name: String(pick(it, ["name", "productName", "title"]) ?? "Unknown item"),
    quantity: asNumber(pick(it, ["quantity", "amount", "count"]), 1),
    unit: optStr(pick(it, ["unit", "unitName", "measure"])),
    price: asNumberOrNull(pick(it, ["price", "unitPrice", "totalPrice"])),
  }));
}

function pickLatest(orders: RawOrder[]): RawOrder {
  const dated = orders.filter((o) => o.orderedAt);
  if (dated.length > 0) {
    return dated.reduce((a, b) => (a.orderedAt! >= b.orderedAt! ? a : b));
  }
  return orders[0];
}

// --- tiny primitives ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pick(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function firstArray(obj: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(obj)) return obj.filter(isRecord);
  if (isRecord(obj)) {
    for (const k of keys) {
      if (Array.isArray(obj[k])) return (obj[k] as unknown[]).filter(isRecord);
    }
  }
  return [];
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function optStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asIso(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
