import { redirect } from "next/navigation";
import { getSession, isLogtoConfigured } from "@/lib/auth";
import PantryClient from "./PantryClient";

export default async function PantryPage() {
  const logtoOn = isLogtoConfigured();
  let userName: string | null = null;

  if (logtoOn) {
    const { isAuthenticated, claims } = await getSession();
    if (!isAuthenticated) redirect("/sign-in");
    userName = claims?.name ?? claims?.email ?? claims?.sub ?? null;
  }

  return <PantryClient logtoOn={logtoOn} userName={userName} />;
}
