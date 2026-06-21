import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDbConfigured } from "@/lib/db";
import { categories } from "@/lib/schema";

export const runtime = "nodejs";

const Body = z.object({ needed: z.boolean() });

// PATCH — toggle a category's "needed" flag (heart on the pantry group header).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not set." }, { status: 500 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  try {
    const { id } = await params;
    const db = getDb();
    await db.update(categories).set({ needed: body.needed }).where(eq(categories.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
