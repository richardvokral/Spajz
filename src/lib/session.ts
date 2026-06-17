// Encrypted-cookie helpers (AES-256-GCM). Used to keep the Rohlik OAuth flow
// state and tokens in HTTP-only cookies. Set ROHLIK_TOKEN_SECRET in production.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret =
    process.env.ROHLIK_TOKEN_SECRET ??
    "spajz-dev-insecure-token-secret-change-me";
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function seal(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const json = Buffer.from(JSON.stringify(data), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function unseal<T>(token: string): T | null {
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}
