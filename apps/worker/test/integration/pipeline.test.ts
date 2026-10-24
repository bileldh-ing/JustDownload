import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMergeArgs, type InspectionView, type JobView } from "@justdownload/core";
import { sweep } from "../../src/cleanup";
import { silentLogger } from "../../src/log";
import { processJob } from "../../src/pipeline";
import { ffprobeFile } from "../../src/probe";
import { runProcess } from "../../src/process";
import { ensureFixtures, FIXTURE_DIR, startFixtureServer, type FixtureServer } from "../fixtures";
import { api, makeHarness, OTHER_SESSION, pathOf, waitForJob, type Harness } from "../harness";

let fx: FixtureServer;
let h: Harness;

beforeAll(async () => {
  await ensureFixtures();
  fx = await startFixtureServer();
  // Small head so remote files are probed partially and jobs really download (no inspection cache).
  h = await makeHarness({ headBytes: 32 * 1024, fullProbeMaxBytes: 1024 });
});
afterAll(async () => {
  await h?.close();
  await fx?.close();
});

async function inspect(url: string, session?: string): Promise<{ status: number; body: InspectionView & { error?: { code: string } } }> {
  const res = await h.app.inject({ method: "POST", url: "/v1/inspections", headers: api(session), payload: { url } });
  return { status: res.statusCode, body: res.json() };
}

async function createJob(inspection_id: string, option_id: string, extra: Record<string, unknown> = {}, session?: string) {
  const res = await h.app.inject({ method: "POST", url: "/v1/jobs", headers: api(session), payload: { inspection_id, option_id, ...extra } });
  return { status: res.statusCode, body: res.json() as JobView & { error?: { code: string } } };
}

async function download(job: JobView): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  const res = await h.app.inject({ method: "GET", url: pathOf(job.download_url!) });
  return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
}

async function probeBuffer(buf: Buffer, ext: string) {
  const f = path.join(os.tmpdir(), `jd-out-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  await writeFile(f, buf);
  return ffprobeFile("ffprobe", f, { partial: false, sizeBytes: buf.length, sniffed: null });
}

describe("vertical slice: URL → inspection → job → validated artifact → download", () => {
  it("inspects a direct MP4 with FFprobe and lists only real options", async () => {
    const { status, body } = await inspect(`${fx.base}/clip.mp4`);
    expect(status).toBe(200);
    expect(body.mode).toBe("full");
    expect(body.media!.video[0]).toMatchObject({ codec: "h264", width: 640, height: 360 });
    expect(body.media!.audio[0]!.codec).toBe("aac");
    expect(body.media!.title).toBe("JustDownload test clip");
    expect(body.media!.partial).toBe(true);
    const ids = body.options.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["video:original", "video:mp4-h264-360", "video:mp4-h264-240", "audio:mp3-v0", "audio:m4a-copy", "audio:wav"]));
    expect(ids.some((i) => /-(480|720|1080|1440|2160)$/.test(i))).toBe(false); // nothing above the 360p source
  });

  it("converts to MP3, validates with FFprobe and serves a real file", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const created = await createJob(insp.id!, "audio:mp3-v2", { filename: "My Song" });
    expect(created.status).toBe(202);
    const job = await waitForJob(h, created.body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    expect(job.percent).toBe(100);
    expect(job.artifact!.audio_codec).toBe("mp3");
    expect(job.artifact!.video_codec).toBeNull();
    const dl = await download(job);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("audio/mpeg");
    expect(String(dl.headers["content-disposition"])).toContain('filename="My Song.mp3"');
    expect(Number(dl.headers["content-length"])).toBe(dl.body.length);
    expect(createHash("sha256").update(dl.body).digest("hex")).toBe(job.artifact!.sha256);
    const p = await probeBuffer(dl.body, "mp3");
    expect(p.audio[0]!.codec).toBe("mp3");
    expect(p.video.length).toBe(0);
    expect(Math.abs(p.durationSec! - 2)).toBeLessThan(0.3);
    // work directories are cleaned after success
    expect(await readdir(path.join(h.dataDir, "work")).catch(() => [])).toEqual([]);
  });

  it("downscales video with H.264 and verifies the resolution", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "video:mp4-h264-240")).body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    expect(job.artifact).toMatchObject({ video_codec: "h264", audio_codec: "aac", height: 240 });
    const p = await probeBuffer((await download(job)).body, "mp4");
    expect(p.video[0]!.height).toBe(240);
  });

  it("remuxes MKV to MP4 without re-encoding", async () => {
    const insp = (await inspect(`${fx.base}/clip.mkv`)).body;
    expect(insp.media!.container).toBe("mkv");
    expect(insp.options.find((o) => o.id === "video:remux-mp4")!.lossy).toBe(false);
    const job = await waitForJob(h, (await createJob(insp.id!, "video:remux-mp4")).body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    expect(job.artifact!.container).toBe("mp4");
  });

  it("delivers the original file byte for byte", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "video:original")).body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    const dl = await download(job);
    expect(dl.body.equals(await readFile(path.join(FIXTURE_DIR, "clip.mp4")))).toBe(true);
  });

  it("converts an uploaded WAV through a signed, single-use upload URL", async () => {
    const t = await h.app.inject({ method: "POST", url: "/v1/uploads/ticket", headers: api() });
    const ticket = t.json() as { upload_url: string };
    const wav = await readFile(path.join(FIXTURE_DIR, "tone.wav"));
    const up = await h.app.inject({ method: "PUT", url: pathOf(ticket.upload_url), headers: { "content-type": "audio/wav", "x-filename": encodeURIComponent("tone ü.wav") }, payload: wav });
    expect(up.statusCode).toBe(200);
    const insp = up.json() as InspectionView;
    expect(insp.source.kind).toBe("upload");
    expect(insp.options.some((o) => o.operation === "original")).toBe(false);
    const again = await h.app.inject({ method: "PUT", url: pathOf(ticket.upload_url), headers: { "content-type": "audio/wav" }, payload: wav });
    expect(again.statusCode).toBe(401); // single use
    const job = await waitForJob(h, (await createJob(insp.id!, "audio:mp3-v5")).body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    expect(job.filename).toBe("tone ü.mp3");
    expect(Math.abs(job.artifact!.duration_sec! - 3)).toBeLessThan(0.3);
  });
});

describe("policy, validation and authorization", () => {
  it("returns a policy result for restricted platforms without fetching anything", async () => {
    const { body } = await inspect("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(body.mode).toBe("policy");
    expect(body.download_allowed).toBe(false);
    expect(body.options).toEqual([]);
    expect(body.id).toBeNull();
  });
  it("rejects option ids that weren't derived from the inspection (no 4K from a 360p source)", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const r = await createJob(insp.id!, "video:mp4-h264-2160");
    expect(r.status).toBe(422);
    expect(r.body.error!.code).toBe("OPTION_NOT_AVAILABLE");
  });
  it("rejects smuggled policy fields and unknown inspections", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    expect((await createJob(insp.id!, "audio:mp3-v0", { provider: "youtube", download: "enabled" })).status).toBe(400);
    expect((await createJob("A".repeat(24), "audio:mp3-v0")).body.error!.code).toBe("INSPECTION_NOT_FOUND");
  });
  it("hides jobs and inspections from other sessions (no enumeration)", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    expect((await createJob(insp.id!, "audio:mp3-v0", {}, OTHER_SESSION)).body.error!.code).toBe("INSPECTION_NOT_FOUND");
    const job = (await createJob(insp.id!, "audio:wav")).body;
    const other = await h.app.inject({ method: "GET", url: `/v1/jobs/${job.id}`, headers: api(OTHER_SESSION) });
    expect(other.statusCode).toBe(404);
    const forged = await h.app.inject({ method: "GET", url: `/v1/jobs/${job.id}/download?exp=9999999999&sig=AAAA` });
    expect(forged.statusCode).toBe(401);
    const noToken = await h.app.inject({ method: "GET", url: `/v1/jobs/${job.id}`, headers: { "x-jd-session": "session_AAAAAAAAAAAAAAAAAAAAAAAA" } });
    expect(noToken.statusCode).toBe(401);
  });
  it("rejects web pages, broken media and SSRF targets with typed errors", async () => {
    expect((await inspect(`${fx.base}/page`)).body.error!.code).toBe("SOURCE_NOT_MEDIA");
    expect((await inspect(`${fx.base}/broken.mp4`)).body.error!.code).toBe("PROBE_FAILED");
    expect((await inspect("http://169.254.169.254/latest/meta-data/")).body.error!.code).toBe("UNSAFE_DESTINATION");
    expect((await inspect("file:///etc/passwd")).body.error!.code).toBe("UNSUPPORTED_SCHEME");
  });
  it("de-duplicates submissions with the same idempotency key", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const a = await createJob(insp.id!, "audio:mp3-v0", { idempotency_key: "key-12345678" });
    const b = await createJob(insp.id!, "audio:mp3-v0", { idempotency_key: "key-12345678" });
    expect(b.body.id).toBe(a.body.id);
  });
});

describe("lifecycle: retries, cancellation, recovery, expiry", () => {
  it("retries a transient source failure and still produces one valid output", async () => {
    const insp = (await inspect(`${fx.base}/flaky/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "audio:mp3-v0")).body.id, (j) => ["ready", "failed"].includes(j.state));
    expect(job.state).toBe("ready");
    expect(job.attempts).toBe(2);
    expect(fx.hits.get("/flaky/clip.mp4")).toBe(3);
  });

  it("cancels during a download, stops the transfer and cleans up", async () => {
    const insp = (await inspect(`${fx.base}/slow/long.mp4`)).body;
    const created = (await createJob(insp.id!, "audio:mp3-v0")).body;
    const downloading = await waitForJob(h, created.id, (j) => j.state === "downloading" && (j.downloaded_bytes ?? 0) > 0);
    expect(downloading.total_bytes).toBeGreaterThan(0);
    const c = await h.app.inject({ method: "POST", url: `/v1/jobs/${created.id}/cancel`, headers: api() });
    expect(c.statusCode).toBe(200);
    const done = await waitForJob(h, created.id, (j) => j.state === "cancelled");
    expect(done.error!.code).toBe("CANCELLED");
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(path.join(h.dataDir, "work", created.id))).toBe(false);
    expect((await h.app.inject({ method: "POST", url: `/v1/jobs/${created.id}/cancel`, headers: api() })).statusCode).toBe(409);
  });

  it("recovers a job left mid-stage by a crashed worker without duplicating output", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "audio:wav")).body.id, (j) => j.state === "ready");
    // Simulate a crash: put a fresh job record mid-"converting" and re-run it as a new attempt.
    const rec = (await h.store.getJob(job.id))!;
    const crashedId = "crashedjob_AAAAAAAAAAAAAAAA";
    await h.store.createJob({ ...rec, id: crashedId, state: "converting", artifact: null, cachedSource: null, attempts: 1 });
    await processJob(crashedId, { attempt: 2, isLastAttempt: false }, { config: h.cfg, store: h.store, storage: h.storage, tools: h.tools, log: silentLogger });
    const after = (await h.store.getJob(crashedId))!;
    expect(after.state).toBe("ready");
    expect(await readdir(path.join(h.dataDir, "artifacts", crashedId))).toHaveLength(1);
  });

  it("expires finished jobs and deletes their artifacts", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "audio:mp3-v5")).body.id, (j) => j.state === "ready");
    const { expired } = await sweep({ config: h.cfg, store: h.store, storage: h.storage, log: silentLogger }, Date.now() + h.cfg.retentionMs + 60_000);
    expect(expired).toBeGreaterThan(0);
    const after = await waitForJob(h, job.id, () => true);
    expect(after.state).toBe("expired");
    expect(existsSync(path.join(h.dataDir, "artifacts", job.id))).toBe(false);
    const dl = await h.app.inject({ method: "GET", url: pathOf(job.download_url!) });
    expect(dl.statusCode).toBe(410);
  });

  it("deletes a job and its artifact on request", async () => {
    const insp = (await inspect(`${fx.base}/clip.mp4`)).body;
    const job = await waitForJob(h, (await createJob(insp.id!, "audio:wav")).body.id, (j) => j.state === "ready");
    expect((await h.app.inject({ method: "DELETE", url: `/v1/jobs/${job.id}`, headers: api() })).statusCode).toBe(204);
    expect((await h.app.inject({ method: "GET", url: `/v1/jobs/${job.id}`, headers: api() })).statusCode).toBe(404);
  });
});

describe("FFmpeg merge of separate video and audio streams", () => {
  it("muxes a video-only and an audio-only input into one validated MP4", async () => {
    const out = path.join(os.tmpdir(), `jd-merge-${Date.now()}.mp4`);
    const r = await runProcess("ffmpeg", buildMergeArgs(path.join(FIXTURE_DIR, "video-only.mp4"), path.join(FIXTURE_DIR, "audio-only.m4a"), out, "mp4"), { timeoutMs: 30_000 });
    expect(r.code).toBe(0);
    const p = await ffprobeFile("ffprobe", out, { partial: false, sizeBytes: null, sniffed: null });
    expect(p.video[0]!.codec).toBe("h264");
    expect(p.audio[0]!.codec).toBe("aac");
  });
});

describe("health", () => {
  it("reports tool versions to the operator only", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(401);
    const res = await h.app.inject({ method: "GET", url: "/v1/health", headers: api() });
    const body = res.json();
    expect(body.tools.ffmpeg).toBeTruthy();
    expect(body.accepting_jobs).toBe(true);
    expect((await h.app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
  });
});
