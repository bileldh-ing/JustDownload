import { copyFile, link, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  JdError, STAGE_LABEL, TERMINAL_STATES, assertDownloadAllowed, buildOutputFilename, buildOutputOptions, findOption, validateRequestedFilename,
  type CreateJobRequest, type JobView,
} from "@justdownload/core";
import { newId, signCapability } from "@justdownload/core/node";
import type { WorkerConfig } from "./config";
import type { Logger } from "./log";
import { errorOf } from "./pipeline";
import type { JobQueue } from "./queue";
import type { ArtifactStorage } from "./storage";
import type { Store } from "./store";
import type { ToolInfo } from "./tools";
import type { JobRecord, QueueName } from "./types";

export interface ServiceDeps {
  config: WorkerConfig;
  store: Store;
  storage: ArtifactStorage;
  queue: JobQueue;
  tools: ToolInfo;
  log: Logger;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

let diskCache = { at: 0, bytes: 0 };
export async function dataDirUsage(cfg: WorkerConfig): Promise<number> {
  if (Date.now() - diskCache.at < 15_000) return diskCache.bytes;
  diskCache = { at: Date.now(), bytes: await dirSize(cfg.dataDir) };
  return diskCache.bytes;
}

export async function assertCapacity(deps: Pick<ServiceDeps, "config" | "queue">): Promise<void> {
  const c = await deps.queue.counts();
  if (c.waiting >= deps.config.maxQueueDepth) throw new JdError("CAPACITY_EXCEEDED", { internal: "queue depth" });
  if ((await dataDirUsage(deps.config)) >= deps.config.maxDiskBytes) throw new JdError("CAPACITY_EXCEEDED", { internal: "disk budget" });
}

/**
 * Create a job from a stored inspection. The option id is re-resolved against options derived
 * server-side from the stored probe and the provider policy is re-checked, so nothing the client
 * sends can select a format that wasn't inspected or a provider that isn't permitted.
 */
export async function createJob(req: CreateJobRequest, sessionHash: string, deps: ServiceDeps): Promise<JobRecord> {
  const { store, config: cfg } = deps;
  const insp = await store.getInspection(req.inspection_id);
  if (!insp || insp.sessionHash !== sessionHash) throw new JdError("INSPECTION_NOT_FOUND");
  const provider = cfg.registry.find((p) => p.id === insp.providerId);
  if (!provider) throw new JdError("PROVIDER_DOWNLOAD_UNAVAILABLE");
  assertDownloadAllowed(provider);
  const options = buildOutputOptions(insp.probe, deps.tools.encoders, { allowOriginal: insp.source.kind === "url" });
  const option = findOption(options, req.option_id);
  if (!option) throw new JdError("OPTION_NOT_AVAILABLE");
  if (req.filename != null && req.filename.trim() !== "") validateRequestedFilename(req.filename);
  const filename = buildOutputFilename(req.filename, insp.probe.title ?? insp.source.filename ?? undefined, option.extension);

  const id = newId();
  if (req.idempotency_key) {
    const existing = await store.claimIdempotency(sessionHash, req.idempotency_key, id, 24 * 3600_000);
    if (existing) {
      const j = await store.getJob(existing);
      if (j) return j;
    }
  }
  await assertCapacity(deps);

  // Pin a private copy (hard link) of any cached source so inspection cleanup can't remove it mid-queue.
  let cachedSource: string | null = null;
  if (insp.cachedSource) {
    const dir = path.join(cfg.dataDir, "job-sources", id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    cachedSource = path.join(dir, "source");
    try { await link(insp.cachedSource, cachedSource); } catch {
      try { await copyFile(insp.cachedSource, cachedSource); } catch { cachedSource = null; }
    }
  }
  const now = Date.now();
  const queue: QueueName = option.kind === "video" ? "video_download" : "audio_conversion";
  const job: JobRecord = {
    id, sessionHash, idempotencyKey: req.idempotency_key ?? null, state: "created",
    percent: null, downloadedBytes: null, totalBytes: null, speed: null, eta: null, messageCode: null, error: null,
    option, filename, inspectionId: insp.id, providerId: provider.id, source: insp.source, probe: insp.probe, sniffed: insp.sniffed, cachedSource, queue,
    attempts: 0, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + cfg.retentionMs + cfg.jobTimeoutMs).toISOString(), artifact: null,
  };
  await store.createJob(job);
  await store.updateJob(id, () => ({ state: "validating" }));
  await store.updateJob(id, () => ({ state: "queued" }));
  await deps.queue.enqueue(queue, id);
  deps.log.info({ job_id: id, provider: provider.id, option: option.id, queue }, "job queued");
  return (await store.getJob(id))!;
}

export async function getOwnedJob(id: string, sessionHash: string, store: Store): Promise<JobRecord> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new JdError("JOB_NOT_FOUND");
  const job = await store.getJob(id);
  // Same error for "missing" and "not yours" so ids can't be probed.
  if (!job || job.sessionHash !== sessionHash) throw new JdError("JOB_NOT_FOUND");
  return job;
}

export function toJobView(job: JobRecord, cfg: WorkerConfig): JobView {
  let download_url: string | null = null;
  let events_url: string | null = null;
  if (cfg.publicUrl) {
    if (job.state === "ready" && job.artifact) {
      const { exp, sig } = signCapability(cfg.signingSecret, "download", job.id, 600);
      download_url = `${cfg.publicUrl}/v1/jobs/${job.id}/download?exp=${exp}&sig=${sig}`;
    }
    if (!TERMINAL_STATES.has(job.state)) {
      const { exp, sig } = signCapability(cfg.signingSecret, "events", job.id, 3600);
      events_url = `${cfg.publicUrl}/v1/jobs/${job.id}/events?exp=${exp}&sig=${sig}`;
    }
  }
  const { storageKey: _k, versions: _v, ...artifact } = job.artifact ?? ({} as NonNullable<JobRecord["artifact"]>);
  return {
    id: job.id, state: job.state, stage_label: STAGE_LABEL[job.state], percent: job.percent, downloaded_bytes: job.downloadedBytes, total_bytes: job.totalBytes,
    speed_bytes_per_second: job.speed, eta_seconds: job.eta, message_code: job.messageCode, error: job.error,
    option: { id: job.option.id, label: job.option.label, extension: job.option.extension, kind: job.option.kind, operation: job.option.operation },
    filename: job.filename, source: { kind: job.source.kind, host: job.source.host, provider_id: job.providerId }, attempts: job.attempts,
    created_at: job.createdAt, updated_at: job.updatedAt, expires_at: job.expiresAt,
    artifact: job.artifact ? artifact : null, download_url, events_url,
  };
}

export async function cancelJob(job: JobRecord, deps: ServiceDeps): Promise<JobRecord> {
  if (TERMINAL_STATES.has(job.state)) throw new JdError("JOB_NOT_CANCELLABLE");
  await deps.store.requestCancel(job.id);
  const removed = await deps.queue.removeWaiting(job.queue, job.id);
  if (removed || job.state === "queued" || job.state === "created" || job.state === "validating") {
    const r = await deps.store.updateJob(job.id, (cur) => (TERMINAL_STATES.has(cur.state) || !["created", "validating", "inspecting", "queued"].includes(cur.state) ? null : { state: "cancelled", error: errorOf(new JdError("CANCELLED")) }));
    if (r?.state === "cancelled") await cleanupJobFiles(job.id, deps);
    return r ?? job;
  }
  // Active: the worker polls the cancel flag, kills FFmpeg/the download and cleans its work dir.
  return job;
}

export async function cleanupJobFiles(jobId: string, deps: Pick<ServiceDeps, "config" | "storage">): Promise<void> {
  await rm(path.join(deps.config.dataDir, "job-sources", jobId), { recursive: true, force: true });
}

export async function deleteJob(job: JobRecord, deps: ServiceDeps): Promise<void> {
  if (!TERMINAL_STATES.has(job.state)) {
    await cancelJob(job, deps).catch(() => undefined);
  }
  await deps.storage.deleteJob(job.id);
  await cleanupJobFiles(job.id, deps);
  await deps.store.deleteJob(job.id);
}
