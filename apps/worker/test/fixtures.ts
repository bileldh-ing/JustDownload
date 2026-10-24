import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../src/process";

/**
 * Test fixtures are generated locally with FFmpeg's synthetic sources (testsrc2 + sine), so they are
 * project-created media with no third-party rights. See docs/TESTING.md.
 */
export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".fixtures");

const RECIPES: Record<string, string[]> = {
  // 2 s 640x360 H.264 + AAC, moov at the front (faststart)
  "clip.mp4": ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", "-metadata", "title=JustDownload test clip"],
  // same, Matroska container (remux candidate)
  "clip.mkv": ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
  // 3 s mono WAV
  "tone.wav": ["-f", "lavfi", "-i", "sine=frequency=523:sample_rate=44100:duration=3", "-c:a", "pcm_s16le"],
  // separate streams for the merge test
  "video-only.mp4": ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an"],
  "audio-only.m4a": ["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=2", "-c:a", "aac", "-vn"],
  // ~20 s larger clip so downloads take long enough to cancel when throttled
  "long.mp4": ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=20", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart"],
};

export async function ensureFixtures(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  for (const [name, args] of Object.entries(RECIPES)) {
    const out = path.join(FIXTURE_DIR, name);
    if (existsSync(out)) continue;
    const r = await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`fixture ${name} failed: ${r.stderr}`);
  }
  const trunc = path.join(FIXTURE_DIR, "broken.mp4");
  if (!existsSync(trunc)) {
    const full = await readFile(path.join(FIXTURE_DIR, "clip.mp4"));
    // Keep the ftyp header but destroy everything after it: looks like MP4, can't be decoded.
    const broken = Buffer.concat([full.subarray(0, 32), Buffer.alloc(4096, 0x41)]);
    await writeFile(trunc, broken);
  }
}

export interface FixtureServer {
  base: string;
  port: number;
  hits: Map<string, number>;
  close(): Promise<void>;
}

/**
 * Minimal static server with Range support. Special paths:
 *  /flaky/<file>  → first GET returns 503, then serves the file
 *  /slow/<file>   → streams 16 KB every 50 ms
 *  /page          → an HTML page
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const hits = new Map<string, number>();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    if (url.pathname === "/page") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><html><head><title>x</title></head></html>"); }
    let p = url.pathname;
    let flaky = false, slow = false;
    if (p.startsWith("/flaky/")) { flaky = true; p = p.slice(6); }
    if (p.startsWith("/slow/")) { slow = true; p = p.slice(5); }
    const file = path.join(FIXTURE_DIR, path.basename(p));
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    if (flaky && hits.get(url.pathname) === 2) { res.writeHead(503); return res.end(); } // 1st hit = inspection head, 2nd = job download
    const data = await readFile(file);
    const type = file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".wav") ? "audio/wav" : file.endsWith(".m4a") ? "audio/mp4" : "application/octet-stream";
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    let body = data;
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      body = data.subarray(start, end + 1);
      res.writeHead(206, { "content-type": type, "content-length": body.length, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes" });
    } else {
      res.writeHead(200, { "content-type": type, "content-length": data.length, "accept-ranges": "bytes" });
    }
    if (!slow) return res.end(body);
    let off = 0;
    const tick = () => {
      if (res.destroyed) return;
      if (off >= body.length) return res.end();
      res.write(body.subarray(off, off + 16 * 1024));
      off += 16 * 1024;
      setTimeout(tick, 50);
    };
    tick();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, hits, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
