/**
 * Progress parsing. FFmpeg's `-progress pipe:1` emits key=value blocks ending in `progress=continue|end`.
 * A percent is computed only when the source duration is actually known; otherwise it stays null and
 * the UI shows an indeterminate stage instead of an invented number.
 */
export interface FfmpegProgress {
  outTimeSec: number | null;
  speed: number | null;
  done: boolean;
}

export class FfmpegProgressParser {
  private cur: Record<string, string> = {};
  /** Feed one line; returns a snapshot when a block completes. */
  push(line: string): FfmpegProgress | null {
    const i = line.indexOf("=");
    if (i <= 0) return null;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    this.cur[k] = v;
    if (k !== "progress") return null;
    const block = this.cur;
    this.cur = {};
    let outTimeSec: number | null = null;
    const us = block["out_time_us"] ?? block["out_time_ms"]; // out_time_ms is (confusingly) microseconds too
    if (us && /^\d+$/.test(us)) outTimeSec = Number(us) / 1e6;
    else if (block["out_time"] && /^\d+:\d{2}:\d{2}(\.\d+)?$/.test(block["out_time"])) {
      const [h, m, s] = block["out_time"].split(":");
      outTimeSec = Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
    const sp = block["speed"] && /^[\d.]+x$/.test(block["speed"]) ? Number(block["speed"].slice(0, -1)) : null;
    return { outTimeSec, speed: Number.isFinite(sp ?? NaN) ? sp : null, done: v === "end" };
  }
}

export function conversionPercent(outTimeSec: number | null, durationSec: number | null): number | null {
  if (outTimeSec == null || !durationSec || durationSec <= 0) return null;
  return Math.max(0, Math.min(99, (outTimeSec / durationSec) * 100));
}

/** Rolling download-rate tracker. Speed/ETA are null until enough data exists to measure them. */
export class RateMeter {
  private samples: Array<{ t: number; bytes: number }> = [];
  constructor(private readonly windowMs = 3000) {}
  add(bytesTotal: number, now = Date.now()): void {
    this.samples.push({ t: now, bytes: bytesTotal });
    while (this.samples.length > 2 && now - this.samples[0]!.t > this.windowMs) this.samples.shift();
  }
  speed(): number | null {
    if (this.samples.length < 2) return null;
    const a = this.samples[0]!;
    const b = this.samples[this.samples.length - 1]!;
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.25) return null;
    return Math.max(0, (b.bytes - a.bytes) / dt);
  }
  eta(total: number | null, done: number): number | null {
    const s = this.speed();
    if (!total || !s || s <= 0) return null;
    return Math.max(0, Math.round((total - done) / s));
  }
}

export function downloadPercent(done: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(99, (done / total) * 100));
}
