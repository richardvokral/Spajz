import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LastOrder, OrderLineItem } from "./types";

const ROHLIK_MCP_URL = "https://mcp.rohlik.cz/mcp";

export interface RohlikCredentials {
  email: string;
  password: string;
}

/**
 * Connects to the Rohlik MCP server using the legacy header auth, fetches the
 * most recent order and returns its normalized line items. The credentials are
 * used only for this call and are never persisted anywhere.
 */
export async function getLastOrder(creds: RohlikCredentials): Promise<LastOrder> {
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
    await client.connect(transport);

    const historyRaw = await client.callTool({
      name: "get_order_history",
      arguments: {},
    });
    const orders = normalizeOrderList(extractJson(historyRaw));
    if (orders.length === 0) {
      throw new Error("No past Rohlik orders were found on this account.");
    }

    const latest = pickLatest(orders);

    const detailRaw = await client.callTool({
      name: "get_order_detail",
      arguments: { orderId: latest.orderId },
    });
    const items = normalizeLineItems(extractJson(detailRaw));

    return { orderId: latest.orderId, orderedAt: latest.orderedAt, items };
  } finally {
    await client.close().catch(() => {});
  }
}

// --- Defensive parsing/normalization (exact Rohlik JSON shape is unknown) ---

function extractJson(result: unknown): unknown {
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content.find(
      (c): c is { type: string; text: string } =>
        typeof c?.type === "string" && c.type === "text" && typeof c?.text === "string"
    )?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return { _raw: text };
      }
    }
  }
  // Some servers return structured content directly.
  return (result as { structuredContent?: unknown }).structuredContent ?? result;
}

function normalizeOrderList(
  data: unknown
): { orderId: string; orderedAt: string | null }[] {
  return firstArray(data, ["orders", "items", "data", "history"])
    .map((o) => ({
      orderId: String(pick(o, ["id", "orderId", "order_id", "number"]) ?? ""),
      orderedAt: asIso(pick(o, ["orderedAt", "createdAt", "date", "created_at"])),
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

function pickLatest(
  orders: { orderId: string; orderedAt: string | null }[]
): { orderId: string; orderedAt: string | null } {
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
