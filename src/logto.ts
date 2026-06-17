import type { LogtoNextConfig } from "@logto/next";

export const logtoConfig: LogtoNextConfig = {
  endpoint: process.env.LOGTO_ENDPOINT ?? "",
  appId: process.env.LOGTO_APP_ID ?? "",
  appSecret: process.env.LOGTO_APP_SECRET ?? "",
  baseUrl: process.env.LOGTO_BASE_URL ?? "http://localhost:3000",
  cookieSecret:
    process.env.LOGTO_COOKIE_SECRET ?? "dev-insecure-cookie-secret-change-me!",
  cookieSecure: process.env.NODE_ENV === "production",
};
