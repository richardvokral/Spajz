import { NextResponse, type NextRequest } from "next/server";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { importLastOrder } from "@/lib/rohlik/mcp";
import {
  RohlikOAuthProvider,
  SESSION_COOKIE,
  type RohlikSession,
} from "@/lib/rohlik/oauth";
import { seal, unseal } from "@/lib/session";
import type { LastOrderResponse } from "@/lib/rohlik/types";

// The MCP SDK needs the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const maxDuration = 60;

const notConnected: LastOrderResponse = {
  ok: false,
  error: 'Not connected to Rohlik. Click "Connect Rohlik" first.',
  debug: { connected: false, toolNames: [], historyTool: null },
};

export async function POST(req: NextRequest): Promise<NextResponse<LastOrderResponse>> {
  const sealed = req.cookies.get(SESSION_COOKIE)?.value;
  const session = sealed ? unseal<RohlikSession>(sealed) : null;
  if (!session?.tokens) {
    return NextResponse.json(notConnected, { status: 401 });
  }

  // Capture refreshed tokens so we can update the cookie if the SDK refreshes.
  const refreshed: { tokens: OAuthTokens | null } = { tokens: null };
  const provider = new RohlikOAuthProvider(
    {
      redirectUri: session.redirectUri,
      clientInformation: session.clientInformation,
      tokens: session.tokens,
    },
    (tokens) => {
      refreshed.tokens = tokens;
    }
  );

  const result = await importLastOrder(provider);
  const res = NextResponse.json(result, { status: result.ok ? 200 : 502 });

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
