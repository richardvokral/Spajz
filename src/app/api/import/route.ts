import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { importOrders, newestOrder } from "@/lib/rohlik/mcp";
import {
  RohlikOAuthProvider,
  SESSION_COOKIE,
  type RohlikSession,
} from "@/lib/rohlik/oauth";
import { seal, unseal } from "@/lib/session";
import { getDb, isDbConfigured } from "@/lib/db";
import { importLogs } from "@/lib/schema";
import { ingestOrders } from "@/lib/pantry/ingest";
import { getSettings } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/client";
import { aiExtractOrders } from "@/lib/ai/parseFallback";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ kind: z.enum(["last", "1month", "6months"]) });

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateStr(d);
}

export async function POST(req: NextRequest) {
  let kind: "last" | "1month" | "6months";
  try {
    kind = Body.parse(await req.json()).kind;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not set — configure Neon first." },
      { status: 500 }
    );
  }

  const sealed = req.cookies.get(SESSION_COOKIE)?.value;
  const session = sealed ? unseal<RohlikSession>(sealed) : null;
  if (!session?.tokens) {
    return NextResponse.json(
      { ok: false, error: 'Not connected to Rohlik. Click "Connect Rohlik" first.' },
      { status: 401 }
    );
  }

  const db = getDb();
  const logRows = await db
    .insert(importLogs)
    .values({ kind, status: "running" })
    .returning({ id: importLogs.id });
  const logId = logRows[0].id;

  const refreshed: { tokens: OAuthTokens | null } = { tokens: null };
  const provider = new RohlikOAuthProvider(
    {
      redirectUri: session.redirectUri,
      clientInformation: session.clientInformation,
      tokens: session.tokens,
    },
    (t) => {
      refreshed.tokens = t;
    }
  );

  const settings = await getSettings();
  const parseFallback =
    settings.aiParseFallbackEnabled && isAiConfigured()
      ? (rawText: string) => aiExtractOrders(rawText, settings.aiModel)
      : undefined;

  const args =
    kind === "last"
      ? { limit: 5, parseFallback }
      : kind === "1month"
        ? { dateFrom: daysAgo(31), dateTo: daysAgo(0), parseFallback }
        : { dateFrom: daysAgo(186), dateTo: daysAgo(0), parseFallback };

  const imp = await importOrders(provider, args);

  let res: NextResponse;
  if (!imp.ok) {
    await db
      .update(importLogs)
      .set({ status: "error", message: imp.error, finishedAt: new Date() })
      .where(eq(importLogs.id, logId));
    res = NextResponse.json({ ok: false, error: imp.error, debug: imp.debug }, { status: 502 });
  } else {
    try {
      const latest = newestOrder(imp.orders);
      const toIngest = kind === "last" ? (latest ? [latest] : []) : imp.orders;
      const ingest = await ingestOrders(toIngest);
      await db
        .update(importLogs)
        .set({
          status: "success",
          ordersSeen: ingest.ordersSeen,
          ordersImported: ingest.ordersImported,
          itemsImported: ingest.itemsImported,
          finishedAt: new Date(),
        })
        .where(eq(importLogs.id, logId));
      res = NextResponse.json({ ok: true, ...ingest, debug: imp.debug });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(importLogs)
        .set({ status: "error", message, finishedAt: new Date() })
        .where(eq(importLogs.id, logId));
      res = NextResponse.json({ ok: false, error: message, debug: imp.debug }, { status: 500 });
    }
  }

  if (refreshed.tokens) {
    res.cookies.set(
      SESSION_COOKIE,
      seal({
        clientInformation: provider.snapshot.clientInformation,
        tokens: refreshed.tokens,
        redirectUri: session.redirectUri,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      }
    );
  }
  return res;
}
