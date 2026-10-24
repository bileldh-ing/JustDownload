import { buildRegistry, parsePolicyOverrides, type ProviderPolicy } from "@justdownload/core";

/** Server-only configuration for the web app (never imported by client components). */
export interface WebConfig {
  workerUrl: string | null;
  workerToken: string | null;
  registry: ProviderPolicy[];
  cookieSecure: boolean;
  allowPrivateNetwork: boolean;
  rateLimitPerMin: number;
}

let cached: WebConfig | null = null;

export function webConfig(): WebConfig {
  if (cached) return cached;
  const production = process.env.NODE_ENV === "production";
  const allowPrivate = process.env.JD_ALLOW_PRIVATE_NETWORK === "1" && process.env.VERCEL !== "1";
  cached = {
    workerUrl: process.env.WORKER_URL ? process.env.WORKER_URL.replace(/\/$/, "") : null,
    workerToken: process.env.WORKER_API_TOKEN ?? null,
    registry: buildRegistry(parsePolicyOverrides(process.env.JD_PROVIDER_POLICY_OVERRIDES)),
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : production,
    allowPrivateNetwork: allowPrivate,
    rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 40),
  };
  return cached;
}

export function workerConfigured(): boolean {
  const c = webConfig();
  return !!(c.workerUrl && c.workerToken);
}
