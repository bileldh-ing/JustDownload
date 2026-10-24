import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque, unguessable identifiers (128+ bits of randomness, URL-safe). */
export function newId(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Short-lived HMAC capability tokens for download, upload and event-stream URLs. */
export function signCapability(secret: string, purpose: string, subject: string, ttlSec: number, now = Date.now()): { exp: number; sig: string } {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = createHmac("sha256", secret).update(`${purpose}:${subject}:${exp}`).digest("base64url");
  return { exp, sig };
}

export function verifyCapability(secret: string, purpose: string, subject: string, exp: string | number | undefined, sig: string | undefined, now = Date.now()): "ok" | "expired" | "invalid" {
  if (exp == null || !sig) return "invalid";
  const e = Number(exp);
  if (!Number.isInteger(e)) return "invalid";
  const expected = createHmac("sha256", secret).update(`${purpose}:${subject}:${e}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return "invalid";
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid";
  if (e < Math.floor(now / 1000)) return "expired";
  return "ok";
}
