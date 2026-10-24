import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import {
  JdError, allowsDownload, buildOutputOptions, normalizeUrl, resolveProvider, sniffContainer, toPublicProvider,
  type InspectionView, type MediaProbe,
} from "@justdownload/core";
import { newId, policyOnlyView } from "@justdownload/core/node";
import { acquireToFile } from "./acquire";
import type { WorkerConfig } from "./config";
import { ffprobeFile } from "./probe";
import type { Store } from "./store";
import type { ToolInfo } from "./tools";
import type { InspectionRecord, SourceRef } from "./types";

export interface InspectDeps {
  config: WorkerConfig;
  store: Store;
  tools: ToolInfo;
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

async function readHead(file: string, n: number): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function assertSniffIsMedia(bytes: Uint8Array, contentType: string | null): string | null {
  const s = sniffContainer(bytes);
  if (s.kind === "manifest") throw new JdError("STREAMING_MANIFEST_UNSUPPORTED");
  if (s.kind === "document") throw new JdError("SOURCE_NOT_MEDIA", { internal: s.label });
  if (s.kind === "unknown" && !(contentType?.startsWith("audio/") || contentType?.startsWith("video/"))) throw new JdError("SOURCE_NOT_MEDIA", { internal: "unrecognised bytes" });
  return s.container;
}

export function toView(rec: InspectionRecord, deps: InspectDeps): InspectionView {
  const provider = deps.config.registry.find((p) => p.id === rec.providerId)!;
  const options = buildOutputOptions(rec.probe, deps.tools.encoders, { allowOriginal: rec.source.kind === "url" });
  const p = rec.probe;
  return {
    id: rec.id, mode: "full",
    source: { kind: rec.source.kind, host: rec.source.host, redacted: rec.source.redacted, filename: rec.source.filename },
    provider: toPublicProvider(provider), download_allowed: allowsDownload(provider),
    media: { title: p.title, artist: p.artist, duration_sec: p.durationSec, size_bytes: p.sizeBytes, container: p.container, format_name: p.formatName, bit_rate: p.bitRate, video: p.video, audio: p.audio, partial: p.partial },
    basic: null, options, notices: rec.notices, inspected_at: rec.createdAt, expires_at: rec.expiresAt,
  };
}

function checkLimits(probe: MediaProbe, cfg: WorkerConfig) {
  if (probe.durationSec != null && probe.durationSec > cfg.maxDurationSec) throw new JdError("SOURCE_TOO_LONG");
  if (probe.sizeBytes != null && probe.sizeBytes > cfg.maxSourceBytes) throw new JdError("SOURCE_TOO_LARGE");
}

/**
 * Full inspection of a URL: policy check → SSRF-safe range fetch of the head (8 MB) → sniff →
 * FFprobe. If the head isn't enough (e.g. MP4 with its index at the end) and the file is small,
 * the whole file is fetched once and kept for the job, so nothing is downloaded twice.
 */
export async function inspectUrl(input: string, sessionHash: string, deps: InspectDeps): Promise<InspectionView> {
  const { config: cfg, store } = deps;
  const urlOpts = { allowPrivateNetwork: cfg.allowPrivateNetwork, resolver: deps.resolver };
  const url = normalizeUrl(input, urlOpts);
  const provider = resolveProvider(url, cfg.registry);
  if (!allowsDownload(provider)) return policyOnlyView(provider, url);
  if (provider.metadataMethod === "approved_extractor") {
    // An operator enabled a platform in policy, but this build ships no extractor-backed adapter
    // (see docs/PROVIDER_POLICY.md). Refuse explicitly rather than scraping the page as "direct media".
    throw new JdError("PROVIDER_UNAVAILABLE", { internal: `no extractor adapter for ${provider.id} in this build` });
  }
  if (!deps.tools.ffprobe) throw new JdError("WORKER_UNAVAILABLE", { internal: "ffprobe missing" });

  const id = newId();
  const dir = path.join(cfg.dataDir, "inspections", id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let keepDir = false;
  try {
    const head = path.join(dir, "head");
    const a = await acquireToFile(url.href, head, { ...urlOpts, maxBytes: cfg.headBytes, headOnly: true, maxRedirects: provider.limits.maxRedirects, timeoutMs: provider.limits.timeoutSeconds * 1000 });
    const finalProvider = resolveProvider(a.finalHost, cfg.registry);
    if (!allowsDownload(finalProvider)) return policyOnlyView(finalProvider, url);
    if (a.total != null && a.total > cfg.maxSourceBytes) throw new JdError("SOURCE_TOO_LARGE");
    const sniffed = assertSniffIsMedia(await readHead(head, 64 * 1024), a.contentType);
    const notices: string[] = [];
    let probe: MediaProbe;
    let cachedSource: string | null = null;
    if (!a.truncated) {
      probe = await ffprobeFile(cfg.tools.ffprobe, head, { partial: false, sizeBytes: a.bytes, sniffed });
      cachedSource = head;
    } else {
      try {
        probe = await ffprobeFile(cfg.tools.ffprobe, head, { partial: true, sizeBytes: a.total, sniffed });
      } catch (e) {
        if (!(e instanceof JdError) || e.code !== "PROBE_FAILED" || a.total == null || a.total > cfg.fullProbeMaxBytes) throw e;
        const full = path.join(dir, "source");
        const f = await acquireToFile(url.href, full, { ...urlOpts, maxBytes: cfg.maxSourceBytes, maxRedirects: provider.limits.maxRedirects, timeoutMs: provider.limits.timeoutSeconds * 1000 });
        probe = await ffprobeFile(cfg.tools.ffprobe, full, { partial: false, sizeBytes: f.bytes, sniffed });
        cachedSource = full;
        await rm(head, { force: true });
      }
      if (probe.partial) {
        notices.push("Only the beginning of this file was analysed. Details are re-checked on the full file before processing.");
        if (probe.durationSec == null) notices.push("Duration is not stored at the start of this file type, so it will be known after the download.");
      }
    }
    checkLimits(probe, cfg);
    notices.push("Sources can change. Streams and sizes are verified again when the job runs.");
    const source: SourceRef = { kind: "url", href: url.href, redacted: url.redacted, host: url.hostname, filename: null };
    const now = Date.now();
    const rec: InspectionRecord = {
      id, sessionHash, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + cfg.inspectionTtlMs).toISOString(),
      source, providerId: provider.id, probe, sniffed, cachedSource, notices,
    };
    if (!cachedSource) await rm(head, { force: true });
    await store.saveInspection(rec, cfg.inspectionTtlMs);
    keepDir = cachedSource != null;
    return toView(rec, deps);
  } finally {
    if (!keepDir) await rm(dir, { recursive: true, force: true });
  }
}

/** Inspect a file uploaded to the worker (already written to `file`). */
export async function inspectUpload(file: string, uploadId: string, originalName: string | null, sessionHash: string, deps: InspectDeps): Promise<InspectionView> {
  const { config: cfg } = deps;
  const provider = cfg.registry.find((p) => p.id === "upload")!;
  if (!allowsDownload(provider)) throw new JdError("PROVIDER_DOWNLOAD_UNAVAILABLE");
  const sniffed = assertSniffIsMedia(await readHead(file, 64 * 1024), null);
  const probe = await ffprobeFile(cfg.tools.ffprobe, file, { partial: false, sizeBytes: null, sniffed });
  checkLimits(probe, cfg);
  const now = Date.now();
  const name = originalName ? originalName.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) : null;
  if (!probe.title && name) probe.title = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const rec: InspectionRecord = {
    id: uploadId, sessionHash, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + cfg.inspectionTtlMs).toISOString(),
    source: { kind: "upload", href: null, redacted: null, host: null, filename: name }, providerId: "upload", probe, sniffed, cachedSource: file,
    notices: ["Your file was analysed with FFprobe. It is deleted automatically after the retention period."],
  };
  await deps.store.saveInspection(rec, cfg.inspectionTtlMs);
  return toView(rec, deps);
}
