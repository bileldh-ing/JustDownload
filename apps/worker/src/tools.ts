import type { EncoderSet } from "@justdownload/core";
import { runProcess } from "./process";

export interface ToolInfo {
  ffmpeg: string | null;
  ffprobe: string | null;
  ytdlp: string | null;
  encoders: EncoderSet;
}

async function version(cmd: string, args: string[], re: RegExp): Promise<string | null> {
  try {
    const r = await runProcess(cmd, args, { timeoutMs: 10_000 });
    if (r.code !== 0) return null;
    const m = re.exec(r.stdout);
    return m ? m[1]! : r.stdout.split("\n")[0]!.trim() || null;
  } catch {
    return null;
  }
}

export function parseEncoders(out: string): EncoderSet {
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const m = /^\s*[VAS][.FSXBD]{5}\s+(\S+)/.exec(line);
    if (m) names.add(m[1]!);
  }
  return { libx264: names.has("libx264"), aac: names.has("aac"), libmp3lame: names.has("libmp3lame"), libopus: names.has("libopus"), pcm_s16le: names.has("pcm_s16le") };
}

/** Detect tool availability and versions at startup (reported in health diagnostics). */
export async function detectTools(paths: { ffmpeg: string; ffprobe: string; ytdlp: string }): Promise<ToolInfo> {
  const [ffmpeg, ffprobe, ytdlp] = await Promise.all([
    version(paths.ffmpeg, ["-hide_banner", "-version"], /ffmpeg version (\S+)/),
    version(paths.ffprobe, ["-hide_banner", "-version"], /ffprobe version (\S+)/),
    version(paths.ytdlp, ["--version"], /^(\S+)/),
  ]);
  let encoders: EncoderSet = { libx264: false, aac: false, libmp3lame: false, libopus: false, pcm_s16le: false };
  if (ffmpeg) {
    try {
      const r = await runProcess(paths.ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 10_000 });
      if (r.code === 0) encoders = parseEncoders(r.stdout);
    } catch { /* keep all false */ }
  }
  return { ffmpeg, ffprobe, ytdlp, encoders };
}
