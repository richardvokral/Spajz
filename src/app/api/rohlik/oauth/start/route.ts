import { NextResponse, type NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAUTH_COOKIE,
  ROHLIK_MCP_URL,
  RohlikOAuthProvider,
} from "@/lib/rohlik/oauth";
import { seal } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(origin: string, detail: string) {
  return NextResponse.redirect(
    new URL(
      `/dashboard?error=oauth_init&detail=${encodeURIComponent(detail.slice(0, 400))}`,
      origin
    )
  );
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectUri = new URL("/api/rohlik/oauth/callback", origin).toString();
  const provider = new RohlikOAuthProvider({ redirectUri });

  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client(
    { name: "spajz", version: "0.1.0" },
    { capabilities: {} }
  );

  // connect() will trigger discovery + dynamic registration + PKCE and capture
  // the authorization URL, then throw because we are not yet authorized.
  let connectError: string | null = null;
  try {
    await client.connect(transport);
  } catch (err) {
    connectError = err instanceof Error ? err.message : String(err);
  } finally {
    await client.close().catch(() => {});
  }

  if (!provider.authorizationUrl) {
    // No auth URL means the SDK never reached the redirect step.
    return fail(
      origin,
      connectError ??
        "Connected to Rohlik without an OAuth challenge — the server did not ask for sign-in."
    );
  }

  const res = NextResponse.redirect(provider.authorizationUrl.toString());
  res.cookies.set(
    OAUTH_COOKIE,
    seal({
      redirectUri,
      clientInformation: provider.snapshot.clientInformation,
      codeVerifier: provider.snapshot.codeVerifier,
      state: provider.snapshot.state,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    }
  );
  return res;
}
