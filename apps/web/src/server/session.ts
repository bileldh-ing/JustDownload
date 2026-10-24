import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { webConfig } from "./config";

/**
 * Guest session: a random, httpOnly cookie. It's forwarded to the worker (hashed there) to prove
 * ownership of inspections and jobs; job ids alone are never enough.
 */
export const SESSION_COOKIE = "jd_sid";

export async function getSession(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{32,64}$/.test(existing)) return existing;
  if (!create) return null;
  const sid = randomBytes(24).toString("base64url");
  jar.set(SESSION_COOKIE, sid, { httpOnly: true, secure: webConfig().cookieSecure, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return sid;
}
