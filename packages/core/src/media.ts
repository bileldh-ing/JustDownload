/**
 * Media model, output options and the FFmpeg argument builder.
 *
 * Honesty rules enforced here:
 *  - Options are derived only from a real probe of the source (plus encoders actually present).
 *  - Resolution labels never exceed the source: a 1080p source never yields a 1440p/4K option.
 *  - Every option says whether it is the original file, a lossless remux/copy, or a lossy re-encode.
 *  - Size estimates are only given when exact (the original file's byte length).
 *  - FFmpeg arguments come from a fixed allowlist keyed by server-generated option ids; no user
 *    string ever becomes a flag, and arguments are passed as an array (never through a shell).
 */

export interface VideoStream {
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  bitRate: number | null;
}

export interface AudioStream {
  index: number;
  codec: string;
  channels: number | null;
  sampleRate: number | null;
  bitRate: number | null;
  language: string | null;
}

export interface MediaProbe {
  /** FFprobe format_name, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  formatName: string;
  /** Canonical container we report to users: mp4, mov, m4a, webm, mkv, mp3, ogg, flac, wav, ... */
  container: string;
  durationSec: number | null;
  sizeBytes: number | null;
  bitRate: number | null;
  title: string | null;
  artist: string | null;
  video: VideoStream[];
  audio: AudioStream[];
  /** True when only the first part of the file was analysed (some fields may be unknown). */
  partial: boolean;
}

export type OutputKind = "video" | "audio";
export type Operation = "original" | "remux" | "copy_audio" | "transcode" | "encode_audio";

export interface OutputOption {
  id: string;
  kind: OutputKind;
  operation: Operation;
  /** File extension of the produced file. */
  extension: string;
  label: string;
  /** Short facts shown under the label, all derived from the probe or the fixed encoder settings. */
  details: string[];
  /** Height label in "p" (shorter side), only for video, never above the source. */
  resolution: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  lossy: boolean;
  /** True only when the output stream data is the source's own data (original/remux/copy). */
  isSourceFormat: boolean;
  /** Exact size in bytes when known (original file only). */
  exactSizeBytes: number | null;
  note: string | null;
}

/** Encoders the worker found in its FFmpeg build (`ffmpeg -encoders`). */
export interface EncoderSet {
  libx264: boolean;
  aac: boolean;
  libmp3lame: boolean;
  libopus: boolean;
  pcm_s16le: boolean;
}

export const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144] as const;
const MP4_VIDEO_COPY = new Set(["h264", "hevc", "av1", "mpeg4"]);
const MP4_AUDIO_COPY = new Set(["aac", "mp3", "ac3", "eac3", "opus", "alac"]);

export const MP3_PRESETS = {
  "mp3-v0": { q: "0", label: "Best available", approxKbps: 245 },
  "mp3-v2": { q: "2", label: "High quality", approxKbps: 190 },
  "mp3-v5": { q: "5", label: "Smaller file", approxKbps: 130 },
} as const;

export function resolutionLabel(p: number): string {
  if (p >= 2160) return "2160p (4K)";
  return `${p}p`;
}

function shortSide(v: VideoStream): number {
  return Math.min(v.width, v.height);
}

function fmtKbps(bps: number | null): string | null {
  return bps && bps > 0 ? `${Math.round(bps / 1000)} kbps` : null;
}

function fmtFps(fps: number | null): string | null {
  if (!fps || !Number.isFinite(fps)) return null;
  return `${Math.round(fps * 100) / 100} fps`;
}

export function primaryVideo(p: MediaProbe): VideoStream | null {
  return p.video[0] ?? null;
}

export function primaryAudio(p: MediaProbe): AudioStream | null {
  return p.audio[0] ?? null;
}

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264", hevc: "H.265/HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg4: "MPEG-4 Part 2", theora: "Theora",
  aac: "AAC", mp3: "MP3", opus: "Opus", vorbis: "Vorbis", flac: "FLAC", ac3: "AC-3", eac3: "E-AC-3", alac: "ALAC",
  pcm_s16le: "PCM 16-bit", pcm_s24le: "PCM 24-bit", pcm_f32le: "PCM float",
};
export function codecName(c: string | null | undefined): string {
  if (!c) return "unknown codec";
  return CODEC_NAMES[c] ?? c.toUpperCase();
}

/**
 * Build the list of output options for a probed source.
 * `allowOriginal` is false for uploads (re-downloading your own upload unchanged is pointless).
 */
export function buildOutputOptions(probe: MediaProbe, enc: EncoderSet, opts: { allowOriginal: boolean }): OutputOption[] {
  const out: OutputOption[] = [];
  const v = primaryVideo(probe);
  const a = primaryAudio(probe);
  const srcAudioKbps = a?.bitRate ? Math.round(a.bitRate / 1000) : null;

  if (v) {
    const src = shortSide(v);
    const vDetails = [`${v.width}×${v.height}`, codecName(v.codec), fmtFps(v.fps), a ? `${codecName(a.codec)} audio` : "no audio track"].filter(Boolean) as string[];
    if (opts.allowOriginal) {
      out.push({
        id: "video:original", kind: "video", operation: "original", extension: probe.container,
        label: `Original file · ${resolutionLabel(src)} ${probe.container.toUpperCase()}`,
        details: vDetails, resolution: src, videoCodec: v.codec, audioCodec: a?.codec ?? null, hasAudio: !!a,
        lossy: false, isSourceFormat: true, exactSizeBytes: probe.sizeBytes,
        note: "Exactly the file the source serves, byte for byte.",
      });
    }
    const canRemux = probe.container !== "mp4" && MP4_VIDEO_COPY.has(v.codec) && (!a || MP4_AUDIO_COPY.has(a.codec));
    if (canRemux) {
      out.push({
        id: "video:remux-mp4", kind: "video", operation: "remux", extension: "mp4",
        label: `MP4 · ${resolutionLabel(src)} (remux, no quality loss)`,
        details: [...vDetails, "streams copied into an MP4 container"], resolution: src, videoCodec: v.codec, audioCodec: a?.codec ?? null, hasAudio: !!a,
        lossy: false, isSourceFormat: true, exactSizeBytes: null,
        note: "Same audio and video data, new container. Fast.",
      });
    }
    if (enc.libx264 && (enc.aac || !a)) {
      const targets: number[] = [];
      if (!STANDARD_HEIGHTS.includes(src as (typeof STANDARD_HEIGHTS)[number])) targets.push(src);
      for (const h of STANDARD_HEIGHTS) if (h <= src) targets.push(h);
      for (const h of targets.slice(0, 4)) {
        const atSource = h === src;
        out.push({
          id: `video:mp4-h264-${h}`, kind: "video", operation: "transcode", extension: "mp4",
          label: `MP4 · ${resolutionLabel(h)} H.264${a ? "/AAC" : ""} (re-encode${atSource ? "" : ", downscaled"})`,
          details: [atSource ? `${v.width}×${v.height} (source size)` : `scaled from ${resolutionLabel(src)}`, "H.264 CRF 23", a ? "AAC 160 kbps" : "no audio track"],
          resolution: h, videoCodec: "h264", audioCodec: a ? "aac" : null, hasAudio: !!a,
          lossy: true, isSourceFormat: false, exactSizeBytes: null,
          note: "Widely compatible. Re-encoding is slower and slightly lossy.",
        });
      }
    }
  }

  if (a && !v && opts.allowOriginal) {
    out.push({
      id: "audio:original", kind: "audio", operation: "original", extension: probe.container,
      label: `Original file · ${probe.container.toUpperCase()} audio`,
      details: [codecName(a.codec), fmtKbps(a.bitRate), a.sampleRate ? `${a.sampleRate / 1000} kHz` : null, a.channels ? `${a.channels} ch` : null].filter(Boolean) as string[],
      resolution: null, videoCodec: null, audioCodec: a.codec, hasAudio: true, lossy: false, isSourceFormat: true, exactSizeBytes: probe.sizeBytes,
      note: "Exactly the file the source serves, byte for byte.",
    });
  }

  if (a) {
    const srcNote = srcAudioKbps ? `Source audio is about ${srcAudioKbps} kbps ${codecName(a.codec)}. Converting can't add quality that isn't in the source.` : "Converting can't add quality that isn't in the source.";
    if (enc.libmp3lame) {
      for (const [key, p] of Object.entries(MP3_PRESETS)) {
        out.push({
          id: `audio:${key}`, kind: "audio", operation: "encode_audio", extension: "mp3",
          label: `MP3 · ${p.label}`,
          details: [`LAME VBR -V${p.q}`, `≈${p.approxKbps} kbps average (varies with content)`, a.sampleRate ? `${a.sampleRate / 1000} kHz` : null].filter(Boolean) as string[],
          resolution: null, videoCodec: null, audioCodec: "mp3", hasAudio: true, lossy: true, isSourceFormat: false, exactSizeBytes: null,
          note: srcNote,
        });
      }
    }
    if (a.codec === "aac") {
      out.push({
        id: "audio:m4a-copy", kind: "audio", operation: "copy_audio", extension: "m4a",
        label: "M4A · Original AAC audio (no re-encode)",
        details: [codecName(a.codec), fmtKbps(a.bitRate), a.channels ? `${a.channels} ch` : null].filter(Boolean) as string[],
        resolution: null, videoCodec: null, audioCodec: "aac", hasAudio: true, lossy: false, isSourceFormat: true, exactSizeBytes: null,
        note: "The source's own audio stream, extracted without quality loss.",
      });
    } else if (enc.aac) {
      out.push({
        id: "audio:m4a-aac-192", kind: "audio", operation: "encode_audio", extension: "m4a",
        label: "M4A · AAC 192 kbps",
        details: ["AAC-LC", "192 kbps target"], resolution: null, videoCodec: null, audioCodec: "aac", hasAudio: true, lossy: true, isSourceFormat: false, exactSizeBytes: null,
        note: srcNote,
      });
    }
    if (a.codec === "opus") {
      out.push({
        id: "audio:opus-copy", kind: "audio", operation: "copy_audio", extension: "opus",
        label: "Opus · Original audio (no re-encode)",
        details: [codecName(a.codec), fmtKbps(a.bitRate)].filter(Boolean) as string[],
        resolution: null, videoCodec: null, audioCodec: "opus", hasAudio: true, lossy: false, isSourceFormat: true, exactSizeBytes: null,
        note: "The source's own audio stream, extracted without quality loss.",
      });
    } else if (enc.libopus) {
      out.push({
        id: "audio:opus-128", kind: "audio", operation: "encode_audio", extension: "opus",
        label: "Opus · 128 kbps",
        details: ["Opus (libopus)", "128 kbps target, VBR"], resolution: null, videoCodec: null, audioCodec: "opus", hasAudio: true, lossy: true, isSourceFormat: false, exactSizeBytes: null,
        note: srcNote,
      });
    }
    if (enc.pcm_s16le) {
      out.push({
        id: "audio:wav", kind: "audio", operation: "encode_audio", extension: "wav",
        label: "WAV · Uncompressed 16-bit",
        details: ["PCM 16-bit", a.sampleRate ? `${a.sampleRate / 1000} kHz` : "source sample rate", "large files"],
        resolution: null, videoCodec: null, audioCodec: "pcm_s16le", hasAudio: true, lossy: false, isSourceFormat: false, exactSizeBytes: null,
        note: "Uncompressed, but it can't restore detail a lossy source already discarded.",
      });
    }
  }
  return out;
}

/** Resolve an option id against freshly derived options. Unknown ids are rejected by the caller. */
export function findOption(options: readonly OutputOption[], id: string): OutputOption | null {
  return options.find((o) => o.id === id) ?? null;
}

/** Strip characters that would confuse tag parsers; FFmpeg receives this as a single argv element. */
export function sanitizeTag(s: string | null | undefined): string | null {
  if (!s) return null;
  const clean = s.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return clean || null;
}

export interface FfmpegPlan {
  args: string[];
  /** What validation must find in the output. */
  expect: { formatIncludes: string; videoCodec: string | null; audioCodec: string | null; shortSide: number | null };
}

/**
 * Build the FFmpeg argv for an option. `input`/`output` are server-generated paths inside the job's
 * private work directory. Throws for `original` (no FFmpeg step) and for unknown option ids.
 */
export function buildFfmpegPlan(option: OutputOption, probe: MediaProbe, input: string, output: string, title: string | null): FfmpegPlan {
  const head = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", input];
  const meta = ["-map_metadata", "-1", ...(sanitizeTag(title) ? ["-metadata", `title=${sanitizeTag(title)}`] : [])];
  const v = primaryVideo(probe);
  const id = option.id;

  if (id === "video:remux-mp4") {
    return { args: [...head, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-sn", "-dn", ...meta, "-movflags", "+faststart", "-f", "mp4", output], expect: { formatIncludes: "mp4", videoCodec: option.videoCodec, audioCodec: option.audioCodec, shortSide: option.resolution } };
  }
  const m = /^video:mp4-h264-(\d{3,4})$/.exec(id);
  if (m) {
    if (!v) throw new Error("no video stream");
    const h = Number(m[1]);
    const src = Math.min(v.width, v.height);
    if (h > src) throw new Error("refusing to upscale");
    const scale = h === src ? [] : ["-vf", v.width >= v.height ? `scale=-2:${h}` : `scale=${h}:-2`];
    const audio = option.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"];
    return {
      args: [...head, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", ...scale, ...audio, ...meta, "-movflags", "+faststart", "-f", "mp4", output],
      expect: { formatIncludes: "mp4", videoCodec: "h264", audioCodec: option.hasAudio ? "aac" : null, shortSide: h },
    };
  }
  const audioHead = [...head, "-map", "0:a:0", "-vn", "-sn", "-dn"];
  const mp3 = /^audio:(mp3-v[025])$/.exec(id);
  if (mp3) {
    const preset = MP3_PRESETS[mp3[1] as keyof typeof MP3_PRESETS];
    return { args: [...audioHead, "-c:a", "libmp3lame", "-q:a", preset.q, ...meta, "-id3v2_version", "3", "-f", "mp3", output], expect: { formatIncludes: "mp3", videoCodec: null, audioCodec: "mp3", shortSide: null } };
  }
  switch (id) {
    case "audio:m4a-copy":
      return { args: [...audioHead, "-c:a", "copy", ...meta, "-movflags", "+faststart", "-f", "ipod", output], expect: { formatIncludes: "mp4", videoCodec: null, audioCodec: "aac", shortSide: null } };
    case "audio:m4a-aac-192":
      return { args: [...audioHead, "-c:a", "aac", "-b:a", "192k", ...meta, "-movflags", "+faststart", "-f", "ipod", output], expect: { formatIncludes: "mp4", videoCodec: null, audioCodec: "aac", shortSide: null } };
    case "audio:opus-copy":
      return { args: [...audioHead, "-c:a", "copy", ...meta, "-f", "ogg", output], expect: { formatIncludes: "ogg", videoCodec: null, audioCodec: "opus", shortSide: null } };
    case "audio:opus-128":
      return { args: [...audioHead, "-c:a", "libopus", "-b:a", "128k", "-vbr", "on", ...meta, "-f", "ogg", output], expect: { formatIncludes: "ogg", videoCodec: null, audioCodec: "opus", shortSide: null } };
    case "audio:wav":
      return { args: [...audioHead, "-c:a", "pcm_s16le", ...meta, "-f", "wav", output], expect: { formatIncludes: "wav", videoCodec: null, audioCodec: "pcm_s16le", shortSide: null } };
    default:
      throw new Error(`no ffmpeg plan for option ${id}`);
  }
}

/** Merge separate video-only and audio-only inputs (stream copy). Used by extractor adapters that deliver split streams. */
export function buildMergeArgs(videoPath: string, audioPath: string, output: string, container: "mp4" | "mkv" | "webm"): string[] {
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
    "-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest",
    ...(container === "mp4" ? ["-movflags", "+faststart", "-f", "mp4"] : container === "webm" ? ["-f", "webm"] : ["-f", "matroska"]),
    output,
  ];
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/** Check a probe of the produced file against what the plan promised. */
export function validateOutputProbe(out: MediaProbe, expect: FfmpegPlan["expect"], sourceDurationSec: number | null, sizeBytes: number): ValidationResult {
  const problems: string[] = [];
  if (!(sizeBytes > 0)) problems.push("output is empty");
  if (!out.formatName.split(",").includes(expect.formatIncludes)) problems.push(`container ${out.formatName} is not ${expect.formatIncludes}`);
  const ov = primaryVideo(out);
  const oa = primaryAudio(out);
  if (expect.videoCodec) {
    if (!ov) problems.push("expected a video stream");
    else if (ov.codec !== expect.videoCodec) problems.push(`video codec ${ov.codec} is not ${expect.videoCodec}`);
    if (ov && expect.shortSide && Math.abs(Math.min(ov.width, ov.height) - expect.shortSide) > 1) problems.push(`resolution ${ov.width}x${ov.height} does not match ${expect.shortSide}p`);
  } else if (ov) {
    problems.push("unexpected video stream in audio output");
  }
  if (expect.audioCodec) {
    if (!oa) problems.push("expected an audio stream");
    else if (oa.codec !== expect.audioCodec) problems.push(`audio codec ${oa.codec} is not ${expect.audioCodec}`);
  }
  if (sourceDurationSec && sourceDurationSec > 0) {
    if (out.durationSec == null) problems.push("output duration unreadable");
    else {
      const tol = Math.max(1.0, sourceDurationSec * 0.02);
      if (Math.abs(out.durationSec - sourceDurationSec) > tol) problems.push(`duration ${out.durationSec.toFixed(2)}s differs from source ${sourceDurationSec.toFixed(2)}s`);
    }
  }
  return { ok: problems.length === 0, problems };
}
