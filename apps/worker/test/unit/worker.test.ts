import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "@justdownload/core";
import { loadConfig } from "../../src/config";
import { canonicalContainer, normalizeProbe } from "../../src/probe";
import { runProcess } from "../../src/process";
import { RateLimiter } from "../../src/ratelimit";
import { LocalStorage } from "../../src/storage";
import { MemoryStore } from "../../src/store";
import { parseEncoders } from "../../src/tools";
import type { JobRecord } from "../../src/types";

describe("config", () => {
  it("refuses insecure production settings", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/WORKER_API_TOKEN/);
    expect(() => loadConfig({ NODE_ENV: "production", WORKER_API_TOKEN: "x".repeat(32), SIGNING_SECRET: "y".repeat(40), JD_ALLOW_PRIVATE_NETWORK: "1" })).toThrow(/never/);
    expect(loadConfig({ NODE_ENV: "production", WORKER_API_TOKEN: "x".repeat(32), SIGNING_SECRET: "y".repeat(40) }).allowPrivateNetwork).toBe(false);
  });
  it("rejects invalid provider overrides at startup", () => {
    expect(() => loadConfig({ JD_PROVIDER_POLICY_OVERRIDES: JSON.stringify({ youtube: { download: "enabled" } }) })).toThrow();
  });
});

describe("probe normalization", () => {
  it("maps ffprobe format names to user-facing containers", () => {
    expect(canonicalContainer("mov,mp4,m4a,3gp,3g2,mj2", "isom", "mp4", true)).toBe("mp4");
    expect(canonicalContainer("mov,mp4,m4a,3gp,3g2,mj2", "M4A ", null, false)).toBe("m4a");
    expect(canonicalContainer("matroska,webm", null, "webm", true)).toBe("webm");
    expect(canonicalContainer("matroska,webm", null, null, true)).toBe("mkv");
    expect(canonicalContainer("mp3", null, null, false)).toBe("mp3");
  });
  it("drops cover-art pseudo video streams and untrusted partial durations", () => {
    const p = normalizeProbe({
      streams: [
        { index: 0, codec_type: "audio", codec_name: "mp3", channels: 2, sample_rate: "44100", bit_rate: "320000" },
        { index: 1, codec_type: "video", codec_name: "mjpeg", width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
      format: { format_name: "mp3", duration: "12.3", tags: { TITLE: "Song\u0007" } },
    }, { partial: true, sizeBytes: 9_000_000, sniffed: "mp3" });
    expect(p.video).toHaveLength(0);
    expect(p.durationSec).toBeNull(); // MP3 head-only duration would be an estimate
    expect(p.title).toBe("Song");
    const mp4 = normalizeProbe({ streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30000/1001" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "60.0" } }, { partial: true, sizeBytes: null, sniffed: "mp4" });
    expect(mp4.durationSec).toBe(60);
    expect(mp4.video[0]!.fps).toBeCloseTo(29.97, 2);
  });
});

describe("encoder detection", () => {
  it("parses ffmpeg -encoders output", () => {
    const e = parseEncoders(" V....D libx264              libx264 H.264\n A....D aac                  AAC\n A....D libmp3lame           MP3\n");
    expect(e).toEqual({ libx264: true, aac: true, libmp3lame: true, libopus: false, pcm_s16le: false });
  });
});

describe("process runner", () => {
  it("passes arguments verbatim without a shell", async () => {
    const r = await runProcess("printf", ["%s", "$(id) ; rm -rf / `x` && echo pwned"], { timeoutMs: 5000 });
    expect(r.stdout).toBe("$(id) ; rm -rf / `x` && echo pwned");
  });
  it("kills on timeout and on abort", async () => {
    expect((await runProcess("sleep", ["5"], { timeoutMs: 100 })).timedOut).toBe(true);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    expect((await runProcess("sleep", ["5"], { timeoutMs: 5000, signal: ac.signal })).aborted).toBe(true);
  });
});

describe("rate limiter", () => {
  it("limits per key per window", () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.take("a", 0), rl.take("a", 1), rl.take("a", 2), rl.take("b", 2), rl.take("a", 1001)]).toEqual([true, true, false, true, true]);
  });
});

describe("storage", () => {
  it("refuses keys that could escape the root", async () => {
    const s = new LocalStorage(await mkdtemp(path.join(os.tmpdir(), "jd-st-")));
    expect(() => s.read("../../etc/passwd")).toThrow();
    expect(await s.stat("AAAAAAAAAAAAAAAAAAAA/../../x")).toBeNull();
    await expect(s.deleteJob("../x")).rejects.toThrow();
  });
});

describe("memory store", () => {
  it("enforces legal transitions on update", async () => {
    const st = new MemoryStore();
    const job = { id: "j".repeat(20), state: "queued", expiresAt: new Date().toISOString() } as unknown as JobRecord;
    await st.createJob(job);
    await expect(st.updateJob(job.id, () => ({ state: "ready" }))).rejects.toBeInstanceOf(IllegalTransitionError);
    expect((await st.updateJob(job.id, () => ({ state: "downloading" })))!.state).toBe("downloading");
  });
  it("claims idempotency keys once", async () => {
    const st = new MemoryStore();
    expect(await st.claimIdempotency("s", "k", "job1", 1000)).toBeNull();
    expect(await st.claimIdempotency("s", "k", "job2", 1000)).toBe("job1");
  });
});
