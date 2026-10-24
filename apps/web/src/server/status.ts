import { toPublicProvider, type PublicProvider } from "@justdownload/core";
import { webConfig } from "./config";
import { workerStatus } from "./worker";

/** Serializable status passed from server components to the client shell. */
export interface AppStatus {
  worker: "online" | "degraded" | "unreachable" | "not_configured";
  tools: { ffmpeg: string | null; ffprobe: string | null } | null;
  queue: { waiting: number | null; active: number | null } | null;
  limits: { max_source_bytes: number; max_duration_sec: number; retention_minutes: number; max_upload_bytes: number } | null;
  workerPublicUrl: string | null;
  providers: PublicProvider[];
  region: string | null;
  /** Dev/test only: lets the client pre-check accept local fixture URLs. Always false on Vercel. */
  allowPrivateNetwork: boolean;
}

export async function appStatus(): Promise<AppStatus> {
  const s = await workerStatus();
  const providers = webConfig().registry.map(toPublicProvider);
  const region = process.env.VERCEL_REGION ?? null;
  const allowPrivateNetwork = webConfig().allowPrivateNetwork;
  if (s.kind !== "online") return { worker: s.kind, tools: null, queue: null, limits: null, workerPublicUrl: null, providers, region, allowPrivateNetwork };
  return {
    worker: s.health.accepting_jobs ? "online" : "degraded",
    tools: { ffmpeg: s.health.tools.ffmpeg, ffprobe: s.health.tools.ffprobe },
    queue: s.health.queue ? { waiting: s.health.queue.waiting, active: s.health.queue.active } : null,
    limits: s.health.limits, workerPublicUrl: s.health.public_url, providers, region, allowPrivateNetwork,
  };
}
