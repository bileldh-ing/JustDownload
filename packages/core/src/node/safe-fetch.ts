import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { JdError } from "../errors";
import { classifyIp, isPublicIp, normalizeUrl, type NormalizedUrl, type UrlPolicyOptions } from "../url-safety";

/**
 * SSRF-hardened HTTP client.
 *  - Every hop (initial URL and each redirect) is statically validated by normalizeUrl().
 *  - The hostname is resolved once per hop; EVERY resolved address must be public, otherwise the
 *    request is refused (mixed public/private records are a rebinding trick).
 *  - The socket connects to the validated address via a pinned `lookup`, so a second DNS answer
 *    can't redirect the connection (DNS rebinding). TLS still verifies the certificate for the hostname.
 *  - Redirects are followed manually, up to `maxRedirects`.
 */
export interface SafeFetchOptions extends UrlPolicyOptions {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  maxRedirects?: number;
  /** Socket idle timeout (ms). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected resolver for tests. */
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: http.IncomingMessage;
  finalUrl: NormalizedUrl;
  redirects: number;
}

export const USER_AGENT = "JustDownload/0.1 (+https://github.com/bileldh-ing/JustDownload)";

async function resolvePublic(target: NormalizedUrl, opts: SafeFetchOptions): Promise<{ address: string; family: 4 | 6 }> {
  if (net.isIP(target.hostname)) {
    if (!isPublicIp(target.hostname, opts)) throw new JdError("UNSAFE_DESTINATION");
    return { address: target.hostname, family: net.isIP(target.hostname) === 6 ? 6 : 4 };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = opts.resolver ? await opts.resolver(target.hostname) : await dnsLookup(target.hostname, { all: true, verbatim: true });
  } catch {
    throw new JdError("DNS_RESOLUTION_FAILED");
  }
  if (!records.length) throw new JdError("DNS_RESOLUTION_FAILED");
  for (const r of records) {
    if (!isPublicIp(r.address, opts)) throw new JdError("UNSAFE_DESTINATION", { internal: `resolved to ${classifyIp(r.address)} address` });
  }
  const first = records[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

function requestOnce(target: NormalizedUrl, pinned: { address: string; family: 4 | 6 }, opts: SafeFetchOptions): Promise<http.IncomingMessage> {
  const lib = target.protocol === "https:" ? https : http;
  const lookup: LookupFunction = (_host, options, cb) => {
    if (options && (options as { all?: boolean }).all) {
      (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(target.href, {
      method: opts.method ?? "GET",
      headers: { "user-agent": USER_AGENT, accept: "*/*", "accept-encoding": "identity", ...(opts.headers ?? {}) },
      lookup,
      signal: opts.signal,
      agent: false,
    });
    req.setTimeout(opts.timeoutMs ?? 15000, () => req.destroy(new JdError("SOURCE_TIMEOUT")));
    req.on("response", resolve);
    req.on("error", (err) => {
      if (err instanceof JdError) return reject(err);
      if ((err as { name?: string }).name === "AbortError") return reject(err);
      reject(new JdError("SOURCE_UNREACHABLE", { internal: (err as { code?: string }).code ?? "request error" }));
    });
    req.end();
  });
}

export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let target = normalizeUrl(input, opts);
  for (let hop = 0; ; hop++) {
    const pinned = await resolvePublic(target, opts);
    const res = await requestOnce(target, pinned, opts);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      res.destroy();
      if (hop >= maxRedirects) throw new JdError("TOO_MANY_REDIRECTS");
      let next: string;
      try {
        next = new URL(res.headers.location, target.href).href;
      } catch {
        throw new JdError("UNSAFE_REDIRECT");
      }
      try {
        target = normalizeUrl(next, opts);
      } catch (e) {
        if (e instanceof JdError && (e.code === "UNSAFE_DESTINATION" || e.code === "UNSUPPORTED_SCHEME" || e.code === "PORT_NOT_ALLOWED" || e.code === "URL_CREDENTIALS_NOT_ALLOWED")) throw new JdError("UNSAFE_REDIRECT", { internal: e.code });
        throw e;
      }
      continue;
    }
    return { status, headers: res.headers, body: res, finalUrl: target, redirects: hop };
  }
}

/** Read at most `max` bytes from a response, then destroy it. */
export async function readPrefix(res: http.IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of res) {
      const b = chunk as Buffer;
      chunks.push(b);
      total += b.length;
      if (total >= max) break;
    }
  } finally {
    res.destroy();
  }
  return Buffer.concat(chunks).subarray(0, max);
}

/** Total size from Content-Range (206) or Content-Length (200). */
export function totalSizeFromHeaders(status: number, headers: http.IncomingHttpHeaders): number | null {
  if (status === 206) {
    const m = /\/(\d+)\s*$/.exec(String(headers["content-range"] ?? ""));
    return m ? Number(m[1]) : null;
  }
  const cl = headers["content-length"];
  return cl && /^\d+$/.test(String(cl)) ? Number(cl) : null;
}
