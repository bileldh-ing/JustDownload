import { JdError, sanitizeTag, type AudioStream, type MediaProbe, type VideoStream } from "@justdownload/core";
import { runProcess } from "./process";

/** Containers whose duration is stored in the header, so a head-only probe reports it correctly. */
const HEADER_DURATION = new Set(["mp4", "mov", "m4a", "webm", "mkv", "3gp"]);

interface FfStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}
interface FfProbeJson {
  streams?: FfStream[];
  format?: { format_name?: string; duration?: string; size?: string; bit_rate?: string; tags?: Record<string, string> };
}

function num(s: string | number | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fps(s: string | undefined): number | null {
  if (!s || s === "0/0") return null;
  const [a, b] = s.split("/").map(Number);
  if (!a || !b) return null;
  const v = a / b;
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
}

function tag(tags: Record<string, string> | undefined, key: string): string | null {
  if (!tags) return null;
  const k = Object.keys(tags).find((t) => t.toLowerCase() === key);
  return k ? sanitizeTag(tags[k]) : null;
}

export function canonicalContainer(formatName: string, majorBrand: string | null, sniffed: string | null, hasVideo: boolean): string {
  const f = formatName.split(",");
  if (f.includes("mov") || f.includes("mp4")) {
    const b = (majorBrand ?? "").trim().toLowerCase();
    if (b.startsWith("m4a")) return "m4a";
    if (b === "qt") return "mov";
    if (sniffed === "m4a" || sniffed === "mov" || sniffed === "3gp") return sniffed;
    return !hasVideo && sniffed === "m4a" ? "m4a" : "mp4";
  }
  if (f.includes("matroska") || f.includes("webm")) return sniffed === "webm" || sniffed === "mkv" ? sniffed : "mkv";
  if (f.includes("mp3")) return "mp3";
  if (f.includes("ogg")) return "ogg";
  if (f.includes("flac")) return "flac";
  if (f.includes("wav")) return "wav";
  if (f.includes("avi")) return "avi";
  if (f.includes("mpegts")) return "ts";
  if (f.includes("aac")) return "aac";
  if (f.includes("flv")) return "flv";
  return f[0] ?? "bin";
}

export function normalizeProbe(json: FfProbeJson, opts: { partial: boolean; sizeBytes: number | null; sniffed: string | null }): MediaProbe {
  const streams = json.streams ?? [];
  const video: VideoStream[] = streams
    .filter((s) => s.codec_type === "video" && !s.disposition?.attached_pic && (s.width ?? 0) > 0 && (s.height ?? 0) > 0)
    .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", width: s.width!, height: s.height!, fps: fps(s.avg_frame_rate) ?? fps(s.r_frame_rate), bitRate: num(s.bit_rate) }));
  const audio: AudioStream[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", channels: s.channels ?? null, sampleRate: num(s.sample_rate), bitRate: num(s.bit_rate), language: tag(s.tags, "language") }));
  const fmt = json.format ?? {};
  const formatName = fmt.format_name ?? "unknown";
  const container = canonicalContainer(formatName, tag(fmt.tags, "major_brand"), opts.sniffed, video.length > 0);
  let durationSec = num(fmt.duration);
  // A truncated read makes FFprobe estimate duration from bitrate for formats without a header
  // duration (MP3, WAV, Ogg...). Those estimates are wrong, so report unknown instead.
  if (opts.partial && !HEADER_DURATION.has(container)) durationSec = null;
  return {
    formatName, container, durationSec,
    sizeBytes: opts.sizeBytes ?? (opts.partial ? null : num(fmt.size)),
    bitRate: opts.partial ? null : num(fmt.bit_rate),
    title: tag(fmt.tags, "title"), artist: tag(fmt.tags, "artist"),
    video, audio, partial: opts.partial,
  };
}

/** Run FFprobe (JSON output) on a local file inside the worker. */
export async function ffprobeFile(ffprobe: string, file: string, opts: { partial: boolean; sizeBytes: number | null; sniffed: string | null; signal?: AbortSignal; timeoutMs?: number }): Promise<MediaProbe> {
  const r = await runProcess(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-protocol_whitelist", "file", "--", file], { timeoutMs: opts.timeoutMs ?? 30_000, signal: opts.signal });
  if (r.aborted) throw new JdError("CANCELLED");
  if (r.timedOut) throw new JdError("PROBE_FAILED", { internal: "ffprobe timeout" });
  let json: FfProbeJson;
  try {
    json = JSON.parse(r.stdout) as FfProbeJson;
  } catch {
    throw new JdError("PROBE_FAILED", { internal: `ffprobe exit ${r.code}: ${r.stderr.slice(0, 300)}` });
  }
  const probe = normalizeProbe(json, opts);
  if (r.code !== 0 && probe.video.length === 0 && probe.audio.length === 0) throw new JdError("PROBE_FAILED", { internal: `ffprobe exit ${r.code}` });
  if (probe.video.length === 0 && probe.audio.length === 0) throw new JdError("PROBE_FAILED", { internal: "no audio or video streams" });
  return probe;
}
