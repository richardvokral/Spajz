import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { settings } from "./schema";

export interface AppSettings {
  aiCategorizationEnabled: boolean;
  aiParseFallbackEnabled: boolean;
  aiModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiCategorizationEnabled: false,
  aiParseFallbackEnabled: false,
  aiModel: "claude-opus-4-8",
};

export const AI_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

export async function getSettings(): Promise<AppSettings> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.id, 1));
  const row = rows[0];
  if (!row) return DEFAULT_SETTINGS;
  return {
    aiCategorizationEnabled: row.aiCategorizationEnabled,
    aiParseFallbackEnabled: row.aiParseFallbackEnabled,
    aiModel: row.aiModel,
  };
}

export async function saveSettings(
  values: Partial<AppSettings>
): Promise<AppSettings> {
  const db = getDb();
  const current = await getSettings();
  const next: AppSettings = { ...current, ...values };
  await db
    .insert(settings)
    .values({ id: 1, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}
