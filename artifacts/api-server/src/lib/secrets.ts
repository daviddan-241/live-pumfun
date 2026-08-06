import { createCipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret = process.env.ARCC_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("ARCC_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function hasSecret(value: string | null): boolean {
  return Boolean(value);
}