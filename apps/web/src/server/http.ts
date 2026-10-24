import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { JdError, errorBody } from "@justdownload/core";
import { webConfig } from "./config";

const hits = new Map<string, { n: number; reset: number }>();

export function clientKey(req: NextRequest): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`client:${ip}`).digest("base64url").slice(0, 24);
}

/** Per-instance fixed-window limiter (serverless instances each keep their own window). */
export function rateLimit(req: NextRequest, bucket: string, limit = webConfig().rateLimitPerMin): void {
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset <= now) {
    hits.set(key, { n: 1, reset: now + 60_000 });
    if (hits.size > 20_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return;
  }
  if (++e.n > limit) throw new JdError("RATE_LIMITED");
}

/** CSRF defence for cookie-authenticated state changes: require a same-origin request. */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new JdError("UNAUTHORIZED");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try {
      if (new URL(origin).host !== host) throw new JdError("UNAUTHORIZED");
    } catch (e) {
      if (e instanceof JdError) throw e;
      throw new JdError("UNAUTHORIZED");
    }
  }
}

export function requestId(): string {
  return randomBytes(9).toString("base64url");
}

export function jsonError(err: unknown, id = requestId()): NextResponse {
  const { status, body } = errorBody(err, id);
  if (!(err instanceof JdError)) console.error(JSON.stringify({ level: "error", request_id: id, msg: "unhandled", detail: String((err as Error)?.message ?? err) }));
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    return jsonError(e);
  }
}

export async function readJson(req: NextRequest, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new JdError("BAD_REQUEST");
  try {
    return JSON.parse(text);
  } catch {
    throw new JdError("BAD_REQUEST");
  }
}
