import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MCP SDK is a server-only dependency with deep CJS/ESM imports; keep it
  // external so the Node.js runtime route bundles cleanly on Vercel.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};

export default nextConfig;
