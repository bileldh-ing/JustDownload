import ipaddr from "ipaddr.js";
import { JdError } from "./errors";

/**
 * URL validation and SSRF classification. Pure functions (no network); the DNS-resolving,
 * redirect-checking fetcher lives in ./node/safe-fetch.ts and calls into these.
 */

export interface UrlPolicyOptions {
  /** Ports allowed for outbound fetches. Default: 80 and 443 only. */
  allowedPorts?: readonly number[];
  /**
   * TEST/DEV ONLY. Allows loopback and private destinations so integration tests can serve
   * fixtures from a local HTTP server. Never enable in a deployment reachable by the public.
   */
  allowPrivateNetwork?: boolean;
}

export const DEFAULT_ALLOWED_PORTS = [80, 443] as const;
const MAX_URL_LENGTH = 4096;

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp", ".localdomain"];
const BLOCKED_HOSTS = new Set([
  "localhost", "metadata", "metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal",
  "kubernetes", "kubernetes.default", "kubernetes.default.svc", "redis", "postgres", "worker", "api", "web",
]);

export type IpClass = "public" | "private" | "loopback" | "link_local" | "multicast" | "reserved" | "unspecified" | "carrier_nat" | "metadata";

/** Classify an IP literal. Anything that is not plainly public unicast is treated as unsafe. */
export function classifyIp(ip: string): IpClass {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return "reserved";
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible and NAT64/6to4 forms are judged by their embedded IPv4.
    if (v6.isIPv4MappedAddress()) return classifyIp(v6.toIPv4Address().toString());
    const parts = v6.parts;
    if (parts.slice(0, 6).every((p) => p === 0) && (parts[6] !== 0 || parts[7]! > 1)) {
      // ::a.b.c.d (deprecated IPv4-compatible)
      const v4 = `${parts[6]! >> 8}.${parts[6]! & 255}.${parts[7]! >> 8}.${parts[7]! & 255}`;
      return classifyIp(v4);
    }
    if (parts[0] === 0x64 && parts[1] === 0xff9b) {
      const v4 = `${parts[6]! >> 8}.${parts[6]! & 255}.${parts[7]! >> 8}.${parts[7]! & 255}`;
      return classifyIp(v4) === "public" ? "public" : "reserved";
    }
    if (parts[0] === 0x2002) {
      const v4 = `${parts[1]! >> 8}.${parts[1]! & 255}.${parts[2]! >> 8}.${parts[2]! & 255}`;
      return classifyIp(v4) === "public" ? "public" : "reserved";
    }
    if (ip.toLowerCase() === "fd00:ec2::254") return "metadata";
    const range = v6.range();
    switch (range) {
      case "unicast": return "public";
      case "loopback": return "loopback";
      case "linkLocal": return "link_local";
      case "uniqueLocal": return "private";
      case "multicast": return "multicast";
      case "unspecified": return "unspecified";
      default: return "reserved";
    }
  }
  const v4 = addr as ipaddr.IPv4;
  const s = v4.toString();
  if (s === "169.254.169.254" || s === "169.254.170.2" || s === "100.100.100.200") return "metadata";
  const range = v4.range();
  switch (range) {
    case "unicast": return "public";
    case "private": return "private";
    case "loopback": return "loopback";
    case "linkLocal": return "link_local";
    case "multicast": return "multicast";
    case "unspecified": return "unspecified";
    case "carrierGradeNat": return "carrier_nat";
    default: return "reserved"; // broadcast, reserved, benchmarking, documentation (TEST-NET), 6to4 relay, etc.
  }
}

export function isPublicIp(ip: string, opts: UrlPolicyOptions = {}): boolean {
  const c = classifyIp(ip);
  if (c === "public") return true;
  if (opts.allowPrivateNetwork && (c === "loopback" || c === "private")) return true;
  return false;
}

export function isIpLiteral(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return ipaddr.isValid(h) && (ipaddr.IPv4.isValidFourPartDecimal(h) || h.includes(":"));
}

export interface NormalizedUrl {
  /** Canonical href with fragment removed. */
  href: string;
  protocol: "http:" | "https:";
  /** Lowercased ASCII (punycode) hostname, without IPv6 brackets. */
  hostname: string;
  port: number;
  pathname: string;
  /** Safe-to-log form: scheme://host/path with query and fragment removed. */
  redacted: string;
}

/**
 * Parse, normalize and statically validate a user-supplied URL. Throws JdError.
 * WHATWG URL parsing canonicalises decimal/hex/octal IPv4 forms (http://2130706433 → 127.0.0.1)
 * and converts IDNs to punycode, so the checks below see the real destination.
 */
export function normalizeUrl(input: string, opts: UrlPolicyOptions = {}): NormalizedUrl {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f\s]/.test(raw)) throw new JdError("INVALID_URL");
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1]!)) throw new JdError("UNSUPPORTED_SCHEME");
  let url: URL;
  try {
    url = new URL(schemeMatch ? raw : `https://${raw}`);
  } catch {
    throw new JdError("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new JdError("UNSUPPORTED_SCHEME");
  if (url.username || url.password) throw new JdError("URL_CREDENTIALS_NOT_ALLOWED");
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname) throw new JdError("INVALID_URL");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const allowedPorts = opts.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  if (!allowedPorts.includes(port) && !opts.allowPrivateNetwork) throw new JdError("PORT_NOT_ALLOWED");

  if (ipaddr.isValid(hostname)) {
    if (!isPublicIp(hostname, opts)) throw new JdError("UNSAFE_DESTINATION", { internal: `ip literal ${classifyIp(hostname)}` });
  } else {
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..")) throw new JdError("INVALID_URL");
    const labels = hostname.split(".");
    if (labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) throw new JdError("INVALID_URL");
    if (!opts.allowPrivateNetwork) {
      if (labels.length < 2) throw new JdError("UNSAFE_DESTINATION", { internal: "single-label host" });
      if (BLOCKED_HOSTS.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) throw new JdError("UNSAFE_DESTINATION", { internal: "blocked internal hostname" });
      // Numeric-looking TLDs are never real public names (catches odd IPv4 spellings the parser kept as names).
      if (/^\d+$/.test(labels[labels.length - 1]!)) throw new JdError("INVALID_URL");
    } else if (hostname !== "localhost" && labels.length < 2 && !BLOCKED_HOSTS.has(hostname)) {
      throw new JdError("UNSAFE_DESTINATION");
    }
  }
  url.hash = "";
  return { href: url.href, protocol: url.protocol as "http:" | "https:", hostname, port, pathname: url.pathname, redacted: redactUrl(url.href) };
}

/** Strip query, fragment and credentials so URLs can be logged without leaking signed tokens. */
export function redactUrl(input: string): string {
  try {
    const u = new URL(input);
    const path = u.pathname.length > 80 ? `${u.pathname.slice(0, 77)}...` : u.pathname;
    return `${u.protocol}//${u.host}${path}${u.search ? "?[redacted]" : ""}`;
  } catch {
    return "[invalid-url]";
  }
}
