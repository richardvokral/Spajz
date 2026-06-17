import { signIn } from "@logto/next/server-actions";
import { logtoConfig } from "@/logto";

export async function GET() {
  // Redirects to Logto. Only reachable in practice when Logto is configured.
  await signIn(logtoConfig);
}
