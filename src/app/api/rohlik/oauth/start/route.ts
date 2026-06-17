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
  try {
    await client.connect(transport);
  } catch {
    // expected
  } finally {
    await client.close().catch(() => {});
  }

  if (!provider.authorizationUrl) {
    return NextResponse.redirect(new URL("/dashboard?error=oauth_init", origin));
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
