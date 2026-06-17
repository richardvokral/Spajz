import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, isLogtoConfigured } from "@/lib/auth";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  type RohlikOAuthState,
} from "@/lib/rohlik/oauth";
import { unseal } from "@/lib/session";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const logtoOn = isLogtoConfigured();
  let userName: string | null = null;

  if (logtoOn) {
    const { isAuthenticated, claims } = await getSession();
    if (!isAuthenticated) redirect("/sign-in");
    userName = claims?.name ?? claims?.email ?? claims?.sub ?? null;
  }

  const cookieStore = await cookies();
  const connected = Boolean(cookieStore.get(SESSION_COOKIE));

  const oauthCookie = cookieStore.get(OAUTH_COOKIE)?.value;
  const pending = oauthCookie ? unseal<RohlikOAuthState>(oauthCookie) : null;
  const pendingAuthUrl = !connected ? (pending?.authUrl ?? null) : null;

  const sp = await searchParams;
  const status =
    typeof sp.connected === "string"
      ? "connected"
      : typeof sp.error === "string"
        ? sp.error
        : null;
  const statusDetail = typeof sp.detail === "string" ? sp.detail : null;

  return (
    <DashboardClient
      logtoOn={logtoOn}
      userName={userName}
      connected={connected}
      pendingAuthUrl={pendingAuthUrl}
      status={status}
      statusDetail={statusDetail}
    />
  );
}
