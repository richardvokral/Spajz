import { NextResponse, type NextRequest } from "next/server";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  RohlikOAuthProvider,
  SESSION_COOKIE,
  type RohlikSession,
} from "@/lib/rohlik/oauth";
import { seal, unseal } from "@/lib/session";
import { getDb, isDbConfigured } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { runCategorization } from "@/lib/category/runCategorization";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not set." },
      { status: 500 }
    );
  }
  const db = getDb();

  // Optional Rohlik session — needed only to fetch Rohlik (MCP) categories.
  const sealed = req.cookies.get(SESSION_COOKIE)?.value;
  const session = sealed ? unseal<RohlikSession>(sealed) : null;
  const refreshed: { tokens: OAuthTokens | null } = { tokens: null };
  let provider: RohlikOAuthProvider | undefined;
  if (session?.tokens) {
    provider = new RohlikOAuthProvider(
      {
        redirectUri: session.redirectUri,
        clientInformation: session.clientInformation,
        tokens: session.tokens,
      },
      (t) => {
        refreshed.tokens = t;
      }
    );
  }

  try {
    const settings = await getSettings();
    const cat = await runCategorization({ db, authProvider: provider, settings });
    const res = NextResponse.json({
      ok: true,
      ...cat,
      connectedToRohlik: Boolean(provider),
    });
    if (refreshed.tokens && session && provider) {
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
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
