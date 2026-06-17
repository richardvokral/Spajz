import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ROHLIK_MCP_URL } from "./oauth";
import type {
  LastOrderResponse,
  OrderLineItem,
  RohlikDebug,
  ToolTrace,
} from "./types";

interface ToolInfo {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> };
}

/**
 * Connects to the Rohlik MCP server with an OAuth access token, reads the most
 * recent order and normalizes its line items. Returns a discriminated result
 * plus a diagnostics trace (so silent auth/format failures are visible instead
 * of collapsing into a misleading "no orders" message).
 */
export async function importLastOrder(
  authProvider: OAuthClientProvider
): Promise<LastOrderResponse> {
  const debug: RohlikDebug = {
    connected: false,
    toolNames: [],
    historyTool: null,
  };

  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    authProvider,
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
        error: `Could not connect to Rohlik — your session may have expired. Click "Connect Rohlik" to sign in again. (${msg(err)})`,
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
      pickTool(
        tools,
        ["fetch_orders", "get_order_history", "get_orders", "list_orders"],
        ["fetch", "order"]
      ) ?? "fetch_orders";
    debug.historyTool = historyTool;
    debug.historyToolSchema =
      tools.find((t) => t.name === historyTool)?.inputSchema ?? null;

    // fetch_orders requires at least one search parameter; limit:1 gives the
    // single most recent (delivered) order.
    const historyArgs: Record<string, unknown> = { limit: 1 };
    const historyRaw = await callTool(client, historyTool, historyArgs);
    debug.history = trace(historyTool, historyArgs, historyRaw);
    if (isToolError(historyRaw)) {
      const raw = textOf(historyRaw) ?? "(no message)";
      const error = looksLikeAuthFailure(raw)
        ? "Rohlik rejected the login. Double-check your Rohlik email and password. If they're correct, Rohlik may have emailed you to confirm a new login — approve it and try again. Accounts with 2-step verification can't be used this way."
        : `Rohlik returned an error from "${historyTool}": ${raw}`;
      return { ok: false, error, debug };
    }

    const historyData = extractData(historyRaw);
    const apiErr = apiErrorMessage(historyData);
    if (apiErr) {
      return {
        ok: false,
        error: `Rohlik could not return your orders: ${apiErr}`,
        debug,
      };
    }

    const orders = normalizeOrderList(historyData);
    if (orders.length === 0) {
      return {
        ok: false,
        error:
          "Connected, but no orders could be parsed from the response. Expand Diagnostics to see what Rohlik returned.",
        debug,
      };
    }

    const latest = pickLatest(orders);

    // Use line items embedded in the summary; otherwise fetch the full order by
    // id (fetch_orders with order_id returns the detailed order).
    let items = normalizeLineItems(latest.raw);
    if (items.length === 0) {
      const detailArgs: Record<string, unknown> = {
        order_id: asIntOrString(latest.orderId),
      };
      const detailRaw = await callTool(client, historyTool, detailArgs);
      debug.detail = trace(historyTool, detailArgs, detailRaw);
      if (!isToolError(detailRaw)) {
        const detailData = extractData(detailRaw);
        if (!apiErrorMessage(detailData)) {
          const detailOrder = normalizeOrderList(detailData)[0];
          items = detailOrder
            ? normalizeLineItems(detailOrder.raw)
            : normalizeLineItems(detailData);
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

function trace(
  tool: string,
  args: Record<string, unknown>,
  result: ToolResult
): ToolTrace {
  const text = textOf(result);
  return {
    tool,
    args,
    isError: result.isError === true,
    text: text ? text.slice(0, 4000) : null,
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

function looksLikeAuthFailure(text: string): boolean {
  return /401|403|unauthorized|forbidden|login request failed|access[_ ]token/i.test(
    text
  );
}

function apiErrorMessage(data: unknown): string | null {
  if (isRecord(data) && data.success === false) {
    return typeof data.message === "string" && data.message.length > 0
      ? data.message
      : "the request was rejected";
  }
  return null;
}

function asIntOrString(s: string): number | string {
  const n = Number(s);
  return Number.isInteger(n) && s.trim() !== "" ? n : s;
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
