import { getLogtoContext } from "@logto/next/server-actions";
import { logtoConfig } from "@/logto";

/**
 * Logto is optional. When all required env vars are present the app gates the
 * dashboard behind sign-in; otherwise it runs without login (dev bypass).
 */
export function isLogtoConfigured(): boolean {
  return Boolean(
    process.env.LOGTO_ENDPOINT &&
      process.env.LOGTO_APP_ID &&
      process.env.LOGTO_APP_SECRET &&
      process.env.LOGTO_COOKIE_SECRET
  );
}

export async function getSession() {
  return getLogtoContext(logtoConfig);
}
