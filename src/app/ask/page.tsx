import { redirect } from "next/navigation";
import { getSession, isLogtoConfigured } from "@/lib/auth";
import AskClient from "./AskClient";

export default async function AskPage() {
  if (isLogtoConfigured()) {
    const { isAuthenticated } = await getSession();
    if (!isAuthenticated) redirect("/sign-in");
  }
  return <AskClient />;
}
