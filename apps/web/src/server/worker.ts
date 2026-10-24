import { JdError, type ErrorBody, type WorkerHealth } from "@justdownload/core";
import { webConfig, workerConfigured } from "./config";

/** Server-to-server client for the JustDownload worker API. The token never reaches the browser. */
export async function workerFetch(path: string, init: { method?: string; body?: unknown; session: string; client: string; timeoutMs?: number }): Promise<{ status: number; body: unknown }> {
  if (!workerConfigured()) throw new JdError("WORKER_NOT_CONFIGURED");
  const cfg = webConfig();
  let res: Response;
  try {
    res = await fetch(`${cfg.workerUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${cfg.workerToken}`,
        "x-jd-session": init.session,
        "x-jd-client": init.client,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      cache: "no-store",
    });
  } catch {
    throw new JdError("WORKER_UNAVAILABLE");
  }
  if (res.status === 204) return { status: 204, body: null };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new JdError("WORKER_UNAVAILABLE");
  }
  if (res.status === 401 && (body as ErrorBody)?.error?.code === "UNAUTHORIZED") throw new JdError("WORKER_UNAVAILABLE", { internal: "worker rejected web token" });
  return { status: res.status, body };
}

export type WorkerStatus =
  | { kind: "not_configured" }
  | { kind: "unreachable" }
  | { kind: "online"; health: WorkerHealth };

let healthCache: { at: number; value: WorkerStatus } | null = null;

export async function workerStatus(): Promise<WorkerStatus> {
  if (!workerConfigured()) return { kind: "not_configured" };
  if (healthCache && Date.now() - healthCache.at < (healthCache.value.kind === "online" ? 15_000 : 3_000)) return healthCache.value;
  const cfg = webConfig();
  let value: WorkerStatus;
  try {
    const res = await fetch(`${cfg.workerUrl}/v1/health`, { headers: { authorization: `Bearer ${cfg.workerToken}` }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    value = res.ok ? { kind: "online", health: (await res.json()) as WorkerHealth } : { kind: "unreachable" };
  } catch {
    value = { kind: "unreachable" };
  }
  healthCache = { at: Date.now(), value };
  return value;
}
