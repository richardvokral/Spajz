import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb, isDbConfigured, rowsOf } from "@/lib/db";
import { isAiConfigured, callStructuredTool } from "@/lib/ai/client";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ question: z.string().min(3).max(500) });

const SCHEMA = `Tables (PostgreSQL):
orders(id uuid, rohlik_order_id text, ordered_at timestamptz, total numeric, currency text, state text, items_count int, imported_at timestamptz)
order_items(id uuid, order_id uuid -> orders.id, product_id uuid -> products.id, name text, quantity numeric, unit text, textual_amount text, price numeric, currency text)
products(id uuid, rohlik_product_id text, name text, unit text, category_id uuid -> categories.id, ai_categorized bool, mcp_category text, mcp_category_path text, first_seen_at timestamptz, last_seen_at timestamptz)
categories(id uuid, name text, slug text)
price_history(id uuid, product_id uuid -> products.id, price numeric, currency text, observed_at timestamptz, rohlik_order_id text)`;

const QUERY_SYSTEM = `You write a single read-only PostgreSQL query that answers the user's question about their grocery pantry.

${SCHEMA}

Rules:
- Return exactly ONE query, a SELECT or WITH ... SELECT. No semicolons. No comments.
- Read-only only: never insert/update/delete/alter/create/drop/etc.
- Use only the tables/columns above. Numeric columns (total, price, quantity) come back as text — cast with ::numeric for math.
- ordered_at/observed_at are timestamptz; a "purchase" is a row in orders.
- Prefer aggregates and add a sensible LIMIT. Order results meaningfully (e.g. by date or by the aggregated value).`;

// Reject anything that is not a single read-only SELECT/WITH. String/identifier
// literals are blanked first so keywords inside product names don't trip the guard.
function guardSql(raw: string): { ok: true; sql: string } | { ok: false; error: string } {
  const noTrailing = raw.trim().replace(/;\s*$/, "");
  const stripped = noTrailing
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  if (/;/.test(stripped)) return { ok: false, error: "Only a single statement is allowed." };
  if (!/^\s*(select|with)\b/i.test(stripped))
    return { ok: false, error: "Only read-only SELECT queries are allowed." };
  const deny =
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|copy|into|call|do|vacuum|analyze|reindex|set|lock|listen|notify|prepare|execute|comment)\b/i;
  if (deny.test(stripped)) return { ok: false, error: "The generated query contained a disallowed keyword." };
  if (/\bpg_|information_schema|drizzle\./i.test(stripped))
    return { ok: false, error: "System tables are not accessible." };
  return { ok: true, sql: noTrailing };
}

export async function POST(req: NextRequest) {
  let question: string;
  try {
    question = Body.parse(await req.json()).question;
  } catch {
    return NextResponse.json({ ok: false, error: "Ask a question (3–500 characters)." }, { status: 400 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set." }, { status: 500 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not set — Ask my pantry needs AI." },
      { status: 500 }
    );
  }

  try {
    const db = getDb();
    const { aiModel: model } = await getSettings();

    // 1. Ask the model for a read-only SQL query.
    const planned = await callStructuredTool<{ sql: string }>({
      model,
      maxTokens: 800,
      system: QUERY_SYSTEM,
      prompt: `User question:\n${question}`,
      toolName: "write_query",
      toolDescription: "Return a single read-only PostgreSQL SELECT (or WITH ... SELECT) query.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "One read-only SELECT or WITH ... SELECT query, no semicolon." },
        },
        required: ["sql"],
      },
    });

    const guard = guardSql(planned.sql ?? "");
    if (!guard.ok) {
      return NextResponse.json({ ok: false, error: guard.error, sql: planned.sql }, { status: 422 });
    }

    // 2. Run it, capped, read-only.
    let rows: Record<string, unknown>[];
    try {
      const wrapped = `select * from (\n${guard.sql}\n) as _spajz_q limit 500`;
      rows = rowsOf(await db.execute(sql.raw(wrapped)));
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `Query failed: ${e instanceof Error ? e.message : String(e)}`, sql: guard.sql },
        { status: 422 }
      );
    }

    // 3. Ask the model to explain the rows (+ optional chart).
    const answer = await callStructuredTool<{
      answer: string;
      chart?: { type: "bar" | "line"; title: string; points: { label: string; value: number }[] };
    }>({
      model,
      maxTokens: 1200,
      system:
        "You are a concise pantry analyst. Answer the user's question using ONLY the provided SQL result rows, citing the key numbers. If the rows form a small series that suits a chart, include a chart spec; otherwise omit it.",
      prompt: `Question: ${question}\n\nSQL used:\n${guard.sql}\n\nResult rows (JSON, may be truncated):\n${JSON.stringify(
        rows.slice(0, 200)
      )}`,
      toolName: "answer",
      toolDescription: "Return a natural-language answer and an optional chart spec.",
      inputSchema: {
        type: "object",
        properties: {
          answer: { type: "string", description: "Concise natural-language answer with the key figures." },
          chart: {
            type: "object",
            description: "Optional chart of the result.",
            properties: {
              type: { type: "string", enum: ["bar", "line"] },
              title: { type: "string" },
              points: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "number" },
                  },
                  required: ["label", "value"],
                },
              },
            },
            required: ["type", "title", "points"],
          },
        },
        required: ["answer"],
      },
    });

    return NextResponse.json({
      ok: true,
      answer: answer.answer,
      chart: answer.chart ?? null,
      sql: guard.sql,
      rows: rows.slice(0, 200),
      rowCount: rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
