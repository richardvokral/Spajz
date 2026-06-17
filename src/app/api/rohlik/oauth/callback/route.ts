import { NextResponse, type NextRequest } from "next/server";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OAUTH_COOKIE,
  ROHLIK_MCP_URL,
  RohlikOAuthProvider,
  SESSION_COOKIE,
  type RohlikOAuthState,
} from "@/lib/rohlik/oauth";
import { seal, unseal } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");

  const sealed = req.cookies.get(OAUTH_COOKIE)?.value;
  const saved = sealed ? unseal<RohlikOAuthState>(sealed) : null;

  if (!code || !saved?.codeVerifier || saved.state !== stateParam) {
    return NextResponse.redirect(new URL("/dashboard?error=oauth_state", origin));
  }

  const provider = new RohlikOAuthProvider({
    redirectUri: saved.redirectUri,
    clientInformation: saved.clientInformation,
    codeVerifier: saved.codeVerifier,
    state: saved.state,
  });
  const transport = new StreamableHTTPClientTransport(new URL(ROHLIK_MCP_URL), {
    authProvider: provider,
  });

  try {
    await transport.finishAuth(code);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(
        `/dashboard?error=oauth_exchange&detail=${encodeURIComponent(detail.slice(0, 400))}`,
        origin
      )
    );
  } finally {
    await transport.close().catch(() => {});
  }

  const tokens = provider.snapshot.tokens;
  if (!tokens) {
    return NextResponse.redirect(new URL("/dashboard?error=oauth_notokens", origin));
  }

  const res = NextResponse.redirect(new URL("/dashboard?connected=1", origin));
  res.cookies.set(
    SESSION_COOKIE,
    seal({
      clientInformation: provider.snapshot.clientInformation,
      tokens,
      redirectUri: saved.redirectUri,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    }
  );
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}
