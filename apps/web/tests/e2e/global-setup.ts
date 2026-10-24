import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

/** Generates project-created fixtures with FFmpeg and serves them (with Range + a slow path). */
export const FIXTURE_PORT = 4599;
const dir = path.join(process.cwd(), "tests", "e2e", ".fixtures");

export default async function globalSetup() {
  mkdirSync(dir, { recursive: true });
  const recipes: Record<string, string[]> = {
    "clip.mp4": ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-metadata", "title=JustDownload E2E clip"],
    // ~20 MB (lossless H.264) so it is larger than the worker's 8 MB inspection head and must be downloaded by the job.
    "big.mp4": ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=12", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12", "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart"],
  };
  for (const [name, args] of Object.entries(recipes)) {
    const out = path.join(dir, name);
    if (existsSync(out)) continue;
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/page.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><html><head></head><body>hi</body></html>"); }
    const slow = u.pathname.startsWith("/slow/");
    const file = path.join(dir, path.basename(u.pathname));
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    const data = readFileSync(file);
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    let body = data;
    if (m) {
      const s = Number(m[1]); const e = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      body = data.subarray(s, e + 1);
      res.writeHead(206, { "content-type": "video/mp4", "content-length": body.length, "content-range": `bytes ${s}-${e}/${data.length}`, "accept-ranges": "bytes" });
    } else res.writeHead(200, { "content-type": "video/mp4", "content-length": data.length, "accept-ranges": "bytes" });
    if (!slow) return res.end(body);
    let off = 0;
    const tick = () => { if (res.destroyed) return; if (off >= body.length) return res.end(); res.write(body.subarray(off, off + 65536)); off += 65536; setTimeout(tick, 40); };
    tick();
  });
  await new Promise<void>((r) => server.listen(FIXTURE_PORT, "127.0.0.1", r));
  return async () => { server.closeAllConnections(); server.close(); };
}
