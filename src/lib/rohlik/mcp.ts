import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ROHLIK_MCP_URL } from "./oauth";
import type { RohlikDebug, ToolTrace } from "./types";

interface ToolInfo {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> };
}

export interface PersistItem {
  rohlikProductId: string | null;
  name: string;
  quantity: number; // count bought (pieces when known, else 1)
  unit: string | null; // raw unit: "l" | "piece" | "kg"
  textualAmount: string | null; // "1 l", "6 ks", "250 g"
  price: number | null; // line total price
  currency: string | null;
}

export interface NormalizedOrder {
  rohlikOrderId: string;
  orderedAt: string | null;
  state: string | null;
  total: number | null;
  currency: string | null;
  itemsCount: number | null;
  items: PersistItem[];
  raw: Record<string, unknown>;
}

export type ImportOrdersResult =
  | { ok: true; orders: NormalizedOrder[]; debug: RohlikDebug }
  | { ok: false; error: string; debug: RohlikDebug };

export interface FetchArgs {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  limit?: number; // 1-15
  /**
   * Optional AI parse-fallback: given the raw response text, returns an extracted
   * JSON payload (e.g. `{ orders: [...] }`) or null. Used only when deterministic
   * parsing yields no orders.
   */
  parseFallback?: (rawText: string) => Promise<unknown | null>;
}

/**
 * Connects to the Rohlik MCP server with an OAuth token and reads orders via
 * `fetch_orders` (date range or limit). Returns normalized, persist-ready orders
 * plus a diagnostics trace.
 */
export async function importOrders(
  authProvider: OAuthClientProvider,
  args: FetchArgs
): Promise<ImportOrdersResult> {
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

    // fetch_orders requires at least one search parameter.
    const toolArgs: Record<string, unknown> = { order_type: "delivered" };
    if (args.dateFrom) toolArgs.date_from = args.dateFrom;
    if (args.dateTo) toolArgs.date_to = args.dateTo;
    if (args.limit) toolArgs.limit = args.limit;
    if (!args.dateFrom && !args.dateTo && !args.limit) toolArgs.limit = 5;

    const raw = await callTool(client, historyTool, toolArgs);
    debug.history = trace(historyTool, toolArgs, raw);
    if (isToolError(raw)) {
      const text = textOf(raw) ?? "(no message)";
      const error = looksLikeAuthFailure(text)
        ? "Rohlik rejected the login. Reconnect Rohlik and approve any new-login email; accounts with 2-step verification can't be used this way."
        : `Rohlik returned an error from "${historyTool}": ${text}`;
      return { ok: false, error, debug };
    }

    let rawOrders: Record<string, unknown>[] = [];
    let apiErr: string | null = null;
    for (const candidate of candidates(raw)) {
      const e = apiErrorMessage(candidate);
      if (e) {
        apiErr = e;
        continue;
      }
      const arr = firstArray(candidate, ["orders", "items", "data", "history"]);
      if (arr.length > 0) {
        rawOrders = arr;
        break;
      }
    }

    // AI parse-fallback for unexpected response shapes.
    if (rawOrders.length === 0 && args.parseFallback) {
      const text = textOf(raw);
      if (text) {
        try {
          const extracted = await args.parseFallback(text);
          const arr = firstArray(extracted, ["orders", "items", "data", "history"]);
          if (arr.length > 0) rawOrders = arr;
        } catch {
          // fall through to the not-parsed error below
        }
      }
    }

    if (rawOrders.length === 0) {
      return {
        ok: false,
        error: apiErr
          ? `Rohlik could not return your orders: ${apiErr}`
          : "Connected, but no orders could be parsed from the response. Expand Diagnostics to see what Rohlik returned.",
        debug,
      };
    }

    const orders = rawOrders
      .map(toNormalizedOrder)
      .filter((o) => o.rohlikOrderId.length > 0);
    return { ok: true, orders, debug };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Picks the newest order by date (for "import last order"). */
export function newestOrder(orders: NormalizedOrder[]): NormalizedOrder | null {
  if (orders.length === 0) return null;
  const dated = orders.filter((o) => o.orderedAt);
  if (dated.length > 0) {
    return dated.reduce((a, b) => (a.orderedAt! >= b.orderedAt! ? a : b));
  }
  return orders[0];
}

export const MCP_CATEGORY_MAX = 80;

export interface ProductCategory {
  category: string;
  path: string;
}

/**
 * Fetches Rohlik product categories for the given product ids. Defensive: tries
 * a batch tool first, else per-product `get_product_details`, and tolerates
 * unknown response shapes. Returns a map (only for products where a category was
 * found) plus a debug sample so field names can be confirmed on a live run.
 */
export async function fetchProductCategories(
  authProvider: OAuthClientProvider,
  productIds: string[]
): Promise<{ map: Record<string, ProductCategory>; debug: RohlikDebug }> {
  const debug: RohlikDebug = {
    connected: false,
    toolNames: [],
    historyTool: null,
  };
  const map: Record<string, ProductCategory> = {};
  if (productIds.length === 0) return { map, debug };

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
    } catch {
      return { map, debug };
    }
    debug.connected = true;

    let tools: ToolInfo[] = [];
    try {
      const listed = await client.listTools();
      tools = (listed.tools ?? []) as ToolInfo[];
      debug.toolNames = tools.map((t) => t.name);
    } catch {
      // ignore
    }

    let sampled = false;
    const sample = (raw: ToolResult) => {
      if (sampled) return;
      const t = textOf(raw);
      try {
        debug.productSample = (
          t ?? JSON.stringify(raw.structuredContent ?? raw)
        ).slice(0, 2000);
      } catch {
        debug.productSample = "[unserializable]";
      }
      sampled = true;
    };

    // 1. Try a batch tool.
    const batchTool = pickTool(
      tools,
      ["get_products_composition_batch", "batch_search_products"],
      ["batch", "product"]
    );
    if (batchTool) {
      debug.categoryTool = batchTool;
      for (const argKey of ["product_ids", "productIds", "ids", "products"]) {
        try {
          const raw = await callTool(client, batchTool, {
            [argKey]: productIds.map(numericIfPossible),
          });
          if (isToolError(raw)) continue;
          const recs = productRecords(raw);
          if (recs.length > 0) {
            for (const rec of recs) extractCategory(map, rec);
            sample(raw);
            break;
          }
        } catch {
          // try next arg key
        }
      }
    }

    // 2. Per-product fallback (bounded).
    const missing = productIds.filter((id) => !map[id]).slice(0, MCP_CATEGORY_MAX);
    if (missing.length > 0) {
      const detailTool = pickTool(
        tools,
        ["get_product_details", "get_product", "product_details"],
        ["product", "detail"]
      );
      if (detailTool) {
        debug.categoryTool = debug.categoryTool ?? detailTool;
        for (const id of missing) {
          for (const argKey of ["productId", "product_id", "id"]) {
            try {
              const raw = await callTool(client, detailTool, {
                [argKey]: numericIfPossible(id),
              });
              if (isToolError(raw)) continue;
              const recs = productRecords(raw);
              const rec =
                recs.find(
                  (r) =>
                    String(pick(r, ["id", "productId", "product_id"]) ?? "") === id
                ) ?? recs[0];
              if (rec) {
                sample(raw);
                const had = Boolean(map[id]);
                extractCategory(map, rec, id);
                if (!had && map[id]) break;
              }
            } catch {
              // try next arg key
            }
          }
        }
      }
    }

    return { map, debug };
  } finally {
    await client.close().catch(() => {});
  }
}

function numericIfPossible(s: string): number | string {
  const n = Number(s);
  return Number.isInteger(n) && s.trim() !== "" ? n : s;
}

function productRecords(raw: ToolResult): Record<string, unknown>[] {
  for (const c of candidates(raw)) {
    const arr = firstArray(c, ["products", "items", "data", "results"]);
    if (arr.length > 0) return arr;
    if (isRecord(c)) {
      const p = c["product"];
      if (isRecord(p)) return [p];
      if (c["categories"] !== undefined || c["id"] !== undefined) return [c];
    }
  }
  return [];
}

function categoryOf(rec: Record<string, unknown>): ProductCategory | null {
  const cats = pick(rec, ["categories", "categoryPath", "category"]);
  if (Array.isArray(cats)) {
    const named = cats
      .filter(isRecord)
      .map((o) => ({
        level: asNumberOrNull(pick(o, ["level"])),
        name: optStr(pick(o, ["name", "title"])),
      }))
      .filter((o): o is { level: number | null; name: string } => Boolean(o.name));
    if (named.length > 0) {
      const path = named.map((n) => n.name).join(" > ");
      const lvl1 = named.find((n) => n.level === 1);
      const nonZero = [...named].reverse().find((n) => n.level !== 0);
      const category = lvl1?.name ?? nonZero?.name ?? named[named.length - 1].name;
      return { category, path };
    }
    const strs = cats.map(optStr).filter((s): s is string => Boolean(s));
    if (strs.length > 0) {
      return { category: strs[strs.length - 1], path: strs.join(" > ") };
    }
    return null;
  }
  const s = optStr(cats);
  return s ? { category: s, path: s } : null;
}

function extractCategory(
  map: Record<string, ProductCategory>,
  rec: Record<string, unknown>,
  fallbackId?: string
): void {
  const id = String(pick(rec, ["id", "productId", "product_id"]) ?? fallbackId ?? "");
  if (!id) return;
  const cat = categoryOf(rec);
  if (cat?.category) map[id] = cat;
}

// --- Normalization (Rohlik fetch_orders shape; see docs/rohlik-mcp.md) ---

function toNormalizedOrder(raw: Record<string, unknown>): NormalizedOrder {
  const total = priceTotal(raw);
  return {
    rohlikOrderId: String(pick(raw, ["id", "orderId", "order_id", "number"]) ?? ""),
    orderedAt: asIso(
      pick(raw, ["orderTime", "orderedAt", "createdAt", "date", "created_at"])
    ),
    state: optStr(pick(raw, ["state", "status"])),
    total: total.amount,
    currency: total.currency,
    itemsCount: asIntOrNull(pick(raw, ["itemsCount", "items_count"])),
    items: normalizePersistItems(raw),
    raw,
  };
}

function priceTotal(raw: Record<string, unknown>): {
  amount: number | null;
  currency: string | null;
} {
  const pc = raw["priceComposition"];
  if (isRecord(pc) && isRecord(pc["total"])) {
    return {
      amount: asNumberOrNull(pc["total"]["amount"]),
      currency: optStr(pc["total"]["currency"]),
    };
  }
  return {
    amount: asNumberOrNull(pick(raw, ["totalPrice", "total"])),
    currency: optStr(pick(raw, ["currency"])),
  };
}

function normalizePersistItems(raw: Record<string, unknown>): PersistItem[] {
  const pieces = piecesByProduct(raw);
  return firstArray(raw, ["items", "lineItems", "products"]).map((it) => {
    const pid = optStr(pick(it, ["productId", "product_id", "id"]));
    const counted = pid ? pieces[pid] : undefined;
    return {
      rohlikProductId: pid,
      name: String(pick(it, ["name", "productName", "title"]) ?? "Unknown item"),
      quantity: counted ?? asNumber(pick(it, ["quantity", "amount", "count"]), 1),
      unit: optStr(pick(it, ["unit", "unitName", "measure"])),
      textualAmount: optStr(pick(it, ["textualAmount", "textual_amount"])),
      price: asNumberOrNull(pick(it, ["totalPrice", "price", "unitPrice"])),
      currency: optStr(pick(it, ["currency"])),
    };
  });
}

// Multi-pack counts live in warrantyInfo.enabledData[].pieces (a subset of items).
function piecesByProduct(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const wi = raw["warrantyInfo"];
  if (isRecord(wi) && Array.isArray(wi["enabledData"])) {
    for (const e of wi["enabledData"]) {
      if (isRecord(e)) {
        const pid = optStr(pick(e, ["productId", "product_id", "id"]));
        const pc = asNumberOrNull(pick(e, ["pieces"]));
        if (pid && pc && pc > 0) out[pid] = pc;
      }
    }
  }
  return out;
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

// Try structuredContent first, then the JSON text body.
function candidates(result: ToolResult): unknown[] {
  const out: unknown[] = [];
  if (
    result.structuredContent !== undefined &&
    result.structuredContent !== null
  ) {
    out.push(result.structuredContent);
  }
  const text = textOf(result);
  if (typeof text === "string") {
    try {
      out.push(JSON.parse(text));
    } catch {
      // not JSON; ignore
    }
  }
  return out;
}

function trace(
  tool: string,
  args: Record<string, unknown>,
  result: ToolResult
): ToolTrace {
  const text = textOf(result);
  const hasStructured =
    result.structuredContent !== undefined && result.structuredContent !== null;
  let structured: string | null = null;
  if (hasStructured) {
    try {
      structured = JSON.stringify(result.structuredContent).slice(0, 4000);
    } catch {
      structured = "[unserializable]";
    }
  }
  return {
    tool,
    args,
    isError: result.isError === true,
    text: text ? text.slice(0, 4000) : null,
    hasStructured,
    structured,
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

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

function asIntOrNull(v: unknown): number | null {
  const n = asNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
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
