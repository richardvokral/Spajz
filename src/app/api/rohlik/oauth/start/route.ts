import { NextResponse, type NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAUTH_COOKIE,
  ROHLIK_MCP_URL,
  RohlikOAuthProvider,
  loopbackRedirectUri,
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
  const redirectUri = loopbackRedirectUri();
  const provider = new RohlikOAuthProvider({ redirectUri });

  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client(
    { name: "spajz", version: "0.1.0" },
    { capabilities: {} }
  );

  // connect() triggers discovery + dynamic registration + PKCE and captures the
  // authorization URL, then throws because we are not yet authorized.
  let connectError: string | null = null;
  try {
    await client.connect(transport);
  } catch (err) {
    connectError = err instanceof Error ? err.message : String(err);
  } finally {
    await client.close().catch(() => {});
  }

  if (!provider.authorizationUrl) {
    return fail(
      origin,
      connectError ??
        "Connected to Rohlik without an OAuth challenge — the server did not ask for sign-in."
    );
  }

  // Stash the flow state + auth URL; the dashboard renders the paste-the-code UI.
  const res = NextResponse.redirect(new URL("/dashboard", origin));
  res.cookies.set(
    OAUTH_COOKIE,
    seal({
      redirectUri,
      clientInformation: provider.snapshot.clientInformation,
      codeVerifier: provider.snapshot.codeVerifier,
      state: provider.snapshot.state,
      authUrl: provider.authorizationUrl.toString(),
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 900,
    }
  );
  return res;
}
