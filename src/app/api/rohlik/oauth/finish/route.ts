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

function fail(origin: string, detail: string) {
  return NextResponse.redirect(
    new URL(
      `/dashboard?error=oauth_exchange&detail=${encodeURIComponent(detail.slice(0, 400))}`,
      origin
    )
  );
}

// The user may paste the bare code or the whole redirected URL.
function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes("code=")) {
    const match = trimmed.match(/[?&]code=([^&\s]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return trimmed;
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;

  const form = await req.formData();
  const code = extractCode(String(form.get("code") ?? ""));

  const sealed = req.cookies.get(OAUTH_COOKIE)?.value;
  const saved = sealed ? unseal<RohlikOAuthState>(sealed) : null;

  if (!code) return fail(origin, "No authorization code was provided.");
  if (!saved?.codeVerifier) {
    return fail(origin, "Sign-in session expired. Click Connect Rohlik again.");
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
    return fail(origin, err instanceof Error ? err.message : String(err));
  } finally {
    await transport.close().catch(() => {});
  }

  const tokens = provider.snapshot.tokens;
  if (!tokens) {
    return fail(origin, "Token exchange returned no tokens.");
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
