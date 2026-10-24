import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, link, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  FfmpegProgressParser, JdError, RateMeter, STAGE_LABEL, buildFfmpegPlan, buildOutputOptions, clampStagePercent, conversionPercent, downloadPercent,
  findOption, validateOutputProbe, type JobState, type MediaProbe,
} from "@justdownload/core";
import { acquireToFile } from "./acquire";
import type { WorkerConfig } from "./config";
import type { Logger } from "./log";
import { ffprobeFile } from "./probe";
import { runProcess } from "./process";
import { PermanentJobError, RetryableJobError, type ProcessContext } from "./queue";
import type { ArtifactStorage } from "./storage";
import type { Store } from "./store";
import type { ToolInfo } from "./tools";
import type { JobRecord } from "./types";

export const WORKER_VERSION = "0.1.0";

export interface PipelineDeps {
  config: WorkerConfig;
  store: Store;
  storage: ArtifactStorage;
  tools: ToolInfo;
  log: Logger;
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

const MIME: Record<string, string> = {
  mp4: "video/mp4", m4a: "audio/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg",
  opus: "audio/ogg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac", avi: "video/x-msvideo", ts: "video/mp2t", aac: "audio/aac", "3gp": "video/3gpp",
};

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

class Cancelled extends Error {}

/**
 * Process one job attempt. Each attempt uses a fresh private work directory, writes outputs to new
 * files only, and always cleans up, so retries can't corrupt or append to earlier output.
 */
export async function processJob(jobId: string, ctx: ProcessContext, deps: PipelineDeps): Promise<void> {
  const { store, config: cfg, log } = deps;
  let job = await store.getJob(jobId);
  if (!job) return;
  if (["ready", "failed", "cancelled", "rejected_by_policy", "expired"].includes(job.state)) return;

  // Recovery: a worker died mid-job (stalled lock); return to queued before starting over.
  if (job.state !== "queued") {
    job = (await store.updateJob(jobId, () => ({ state: "queued", messageCode: "RECOVERED_AFTER_WORKER_RESTART", percent: null })))!;
  }

  const abort = new AbortController();
  let cancelled = false;
  const poll = setInterval(() => {
    void store.isCancelRequested(jobId).then((c) => { if (c && !cancelled) { cancelled = true; abort.abort(); } }).catch(() => undefined);
  }, 500);
  const timeout = setTimeout(() => abort.abort(), cfg.jobTimeoutMs);
  const workDir = path.join(cfg.dataDir, "work", jobId, `attempt-${ctx.attempt}`);
  let lastWrite = 0;

  const setState = async (state: JobState, extra: Partial<JobRecord> = {}) => {
    if (abort.signal.aborted) throw new Cancelled();
    job = (await store.updateJob(jobId, (cur) => (cur.state === "cancelled" ? null : { state, percent: null, downloadedBytes: null, totalBytes: null, speed: null, eta: null, messageCode: null, ...extra })))!;
    if (job.state === "cancelled") throw new Cancelled();
  };
  const progress = async (patch: Partial<JobRecord>, force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 400) return;
    lastWrite = now;
    await store.updateJob(jobId, (cur) => (cur.state === "cancelled" ? null : { ...patch, percent: clampStagePercent(cur.state, patch.percent ?? null) }));
  };

  try {
    if (await store.isCancelRequested(jobId)) throw new Cancelled();
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    const sourcePath = path.join(workDir, "source");

    // ---- Input acquisition -------------------------------------------------------------------
    if (job.cachedSource && existsSync(job.cachedSource)) {
      try { await link(job.cachedSource, sourcePath); } catch { await copyFile(job.cachedSource, sourcePath); }
    } else if (job.source.kind === "url" && job.source.href) {
      await setState("downloading", { attempts: ctx.attempt, totalBytes: job.probe.sizeBytes });
      const meter = new RateMeter();
      const provider = cfg.registry.find((p) => p.id === job!.providerId)!;
      await acquireToFile(job.source.href, sourcePath, {
        maxBytes: cfg.maxSourceBytes, allowPrivateNetwork: cfg.allowPrivateNetwork, resolver: deps.resolver, signal: abort.signal,
        maxRedirects: provider.limits.maxRedirects, timeoutMs: provider.limits.timeoutSeconds * 1000,
        onProgress: (done, total) => {
          meter.add(done);
          void progress({ downloadedBytes: done, totalBytes: total, percent: downloadPercent(done, total), speed: meter.speed(), eta: meter.eta(total, done) });
        },
      });
    } else {
      throw new JdError("INSPECTION_NOT_FOUND", { internal: "uploaded source no longer available" });
    }
    if (abort.signal.aborted) throw new Cancelled();

    // ---- Re-probe the complete source and re-resolve the option (never trust stale ids) -------
    const fullProbe: MediaProbe = await ffprobeFile(cfg.tools.ffprobe, sourcePath, { partial: false, sizeBytes: (await stat(sourcePath)).size, sniffed: job.sniffed, signal: abort.signal });
    if (fullProbe.durationSec != null && fullProbe.durationSec > cfg.maxDurationSec) throw new JdError("SOURCE_TOO_LONG");
    const options = buildOutputOptions(fullProbe, deps.tools.encoders, { allowOriginal: job.source.kind === "url" });
    const option = findOption(options, job.option.id);
    if (!option) throw new JdError("OPTION_NOT_AVAILABLE", { internal: "option disappeared after full probe (source changed?)" });

    // ---- Convert (or keep the original) --------------------------------------------------------
    const outPath = path.join(workDir, `output.${option.extension}`);
    let expect: ReturnType<typeof buildFfmpegPlan>["expect"];
    if (option.operation === "original") {
      expect = { formatIncludes: fullProbe.formatName.split(",")[0]!, videoCodec: fullProbe.video[0]?.codec ?? null, audioCodec: fullProbe.audio[0]?.codec ?? null, shortSide: option.resolution };
      try { await link(sourcePath, outPath); } catch { await copyFile(sourcePath, outPath); }
    } else {
      if (!deps.tools.ffmpeg) throw new JdError("WORKER_UNAVAILABLE", { internal: "ffmpeg missing" });
      const plan = buildFfmpegPlan(option, fullProbe, sourcePath, outPath, fullProbe.title ?? job.probe.title);
      expect = plan.expect;
      await setState("converting", { attempts: ctx.attempt });
      const parser = new FfmpegProgressParser();
      const r = await runProcess(cfg.tools.ffmpeg, plan.args, {
        timeoutMs: cfg.jobTimeoutMs, signal: abort.signal, cwd: workDir,
        onStdoutLine: (line) => {
          const snap = parser.push(line);
          if (snap) void progress({ percent: conversionPercent(snap.outTimeSec, fullProbe.durationSec), speed: null, eta: null, messageCode: snap.speed ? `SPEED_${snap.speed}x` : null });
        },
      });
      if (r.aborted || abort.signal.aborted) throw new Cancelled();
      if (r.timedOut) throw new JdError("CONVERSION_FAILED", { internal: "ffmpeg timeout", retryable: false });
      if (r.code !== 0) throw new JdError("CONVERSION_FAILED", { internal: `ffmpeg exit ${r.code}: ${r.stderr.slice(-400)}` });
    }

    // ---- Validate the actual output -------------------------------------------------------------
    await setState("validating_output");
    const size = (await stat(outPath)).size;
    const outProbe = await ffprobeFile(cfg.tools.ffprobe, outPath, { partial: false, sizeBytes: size, sniffed: null, signal: abort.signal }).catch(() => null);
    if (!outProbe) throw new JdError("OUTPUT_VALIDATION_FAILED", { internal: "ffprobe could not read output" });
    const v = validateOutputProbe(outProbe, expect, option.operation === "original" ? null : fullProbe.durationSec, size);
    if (!v.ok) throw new JdError("OUTPUT_VALIDATION_FAILED", { internal: v.problems.join("; ") });
    const sha256 = await sha256File(outPath);

    // ---- Finalize: store artifact + manifest, then mark ready -----------------------------------
    const stored = await deps.storage.put(jobId, outPath);
    const now = Date.now();
    const ov = outProbe.video[0] ?? null;
    const oa = outProbe.audio[0] ?? null;
    await setState("ready", {
      percent: 100,
      artifact: {
        storageKey: stored.key, filename: job.filename, size_bytes: stored.size, sha256, mime_type: MIME[option.extension] ?? "application/octet-stream",
        container: option.extension, duration_sec: outProbe.durationSec, video_codec: ov?.codec ?? null, audio_codec: oa?.codec ?? null,
        width: ov?.width ?? null, height: ov?.height ?? null, created_at: new Date(now).toISOString(), expires_at: new Date(now + cfg.retentionMs).toISOString(),
        versions: { worker: WORKER_VERSION, ffmpeg: deps.tools.ffmpeg, ffprobe: deps.tools.ffprobe },
      },
      expiresAt: new Date(now + cfg.retentionMs).toISOString(),
    });
    log.info({ job_id: jobId, provider: job.providerId, stage: "ready", option: option.id, size_bytes: stored.size }, "job ready");
  } catch (e) {
    if (e instanceof Cancelled || (abort.signal.aborted && cancelled)) {
      await store.updateJob(jobId, (cur) => (cur.state === "cancelled" ? null : { state: "cancelled", percent: null, speed: null, eta: null, error: errorOf(new JdError("CANCELLED")) })).catch(() => undefined);
      log.info({ job_id: jobId, stage: "cancelled" }, "job cancelled");
      return;
    }
    const err = e instanceof JdError ? e : abort.signal.aborted ? new JdError("CONVERSION_FAILED", { internal: "job timeout", retryable: false }) : new JdError("INTERNAL", { internal: String((e as Error)?.message ?? e) });
    log.warn({ job_id: jobId, provider: job.providerId, stage: job.state, error_code: err.code, detail: err.internal, attempt: ctx.attempt }, "job attempt failed");
    if (err.retryable && !ctx.isLastAttempt) {
      await store.updateJob(jobId, () => ({ state: "queued", attempts: ctx.attempt, messageCode: `RETRYING_${err.code}`, percent: null, speed: null, eta: null })).catch(() => undefined);
      throw new RetryableJobError(err.code);
    }
    await store.updateJob(jobId, (cur) => (cur.state === "cancelled" ? null : { state: "failed", attempts: ctx.attempt, error: errorOf(err), percent: null, speed: null, eta: null })).catch(() => undefined);
    throw new PermanentJobError(err.code);
  } finally {
    clearInterval(poll);
    clearTimeout(timeout);
    await rm(path.join(cfg.dataDir, "work", jobId), { recursive: true, force: true }).catch(() => undefined);
    const final = await store.getJob(jobId).catch(() => null);
    if (final && ["ready", "failed", "cancelled"].includes(final.state)) {
      await rm(path.join(cfg.dataDir, "job-sources", jobId), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function errorOf(e: JdError): JobRecord["error"] {
  return { code: e.code, message: e.message, action: e.action, retryable: e.retryable };
}

export function stageLabel(state: JobState): string {
  return STAGE_LABEL[state];
}
