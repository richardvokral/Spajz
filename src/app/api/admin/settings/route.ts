import { NextResponse } from "next/server";
import { z } from "zod";
import { isDbConfigured } from "@/lib/db";
import { AI_MODELS, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";

const Body = z.object({
  aiCategorizationEnabled: z.boolean().optional(),
  aiParseFallbackEnabled: z.boolean().optional(),
  aiModel: z.enum(AI_MODELS).optional(),
});

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not set." },
      { status: 500 }
    );
  }
  let values;
  try {
    values = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid settings." }, { status: 400 });
  }
  try {
    const settings = await saveSettings(values);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
