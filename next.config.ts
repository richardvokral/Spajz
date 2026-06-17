import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MCP SDK is a server-only dependency with deep CJS/ESM imports; keep it
  // external so the Node.js runtime routes bundle cleanly on Vercel.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // Ship the Drizzle migration SQL + journal in the serverless bundle so the
  // admin "apply migrations" route can read them at runtime on Vercel.
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./drizzle/**/*"],
    "/api/admin/status": ["./drizzle/**/*"],
  },
};

export default nextConfig;
