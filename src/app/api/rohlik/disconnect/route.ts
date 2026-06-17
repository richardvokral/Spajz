import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/rohlik/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}
