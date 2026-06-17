import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, isLogtoConfigured } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/rohlik/oauth";
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

  const sp = await searchParams;
  const status =
    typeof sp.connected === "string"
      ? "connected"
      : typeof sp.error === "string"
        ? sp.error
        : null;

  return (
    <DashboardClient
      logtoOn={logtoOn}
      userName={userName}
      connected={connected}
      status={status}
    />
  );
}
