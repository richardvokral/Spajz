import { redirect } from "next/navigation";
import { getSession, isLogtoConfigured } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const logtoOn = isLogtoConfigured();
  let userName: string | null = null;

  if (logtoOn) {
    const { isAuthenticated, claims } = await getSession();
    if (!isAuthenticated) redirect("/sign-in");
    userName = claims?.name ?? claims?.email ?? claims?.sub ?? null;
  }

  return <DashboardClient logtoOn={logtoOn} userName={userName} />;
}
