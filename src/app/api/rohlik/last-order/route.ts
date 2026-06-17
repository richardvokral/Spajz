import { NextResponse } from "next/server";
import { z } from "zod";
import { getLastOrder } from "@/lib/rohlik/mcp";
import type { LastOrderResponse } from "@/lib/rohlik/types";

// The MCP SDK needs the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse<LastOrderResponse>> {
  let creds: z.infer<typeof Body>;
  try {
    creds = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Enter a valid Rohlik email and password." },
      { status: 400 }
    );
  }

  try {
    // Credentials are used only here and are never stored or logged.
    const order = await getLastOrder(creds);
    return NextResponse.json({ ok: true, order });
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Could not reach the Rohlik MCP server.";
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }
}
