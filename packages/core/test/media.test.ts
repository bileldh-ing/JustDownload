import { describe, expect, it } from "vitest";
import { buildFfmpegPlan, buildMergeArgs, buildOutputOptions, findOption, validateOutputProbe, type EncoderSet, type MediaProbe } from "../src";

const ALL: EncoderSet = { libx264: true, aac: true, libmp3lame: true, libopus: true, pcm_s16le: true };

function probe(over: Partial<MediaProbe> = {}): MediaProbe {
  return {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2", container: "mp4", durationSec: 10, sizeBytes: 1_000_000, bitRate: 800_000, title: "Clip", artist: null,
    video: [{ index: 0, codec: "h264", width: 1920, height: 1080, fps: 30, bitRate: 700_000 }],
    audio: [{ index: 1, codec: "aac", channels: 2, sampleRate: 48000, bitRate: 128_000, language: null }],
    partial: false, ...over,
  };
}

describe("buildOutputOptions", () => {
  it("never offers a resolution above the source", () => {
    const opts = buildOutputOptions(probe(), ALL, { allowOriginal: true });
    const res = opts.filter((o) => o.kind === "video").map((o) => o.resolution!);
    expect(Math.max(...res)).toBe(1080);
    expect(opts.some((o) => o.label.includes("4K") || o.label.includes("1440"))).toBe(false);
    expect(opts.map((o) => o.id)).toEqual(expect.arrayContaining(["video:original", "video:mp4-h264-1080", "video:mp4-h264-720", "audio:mp3-v0", "audio:m4a-copy"]));
  });
  it("labels 4K only when the source really is 2160p", () => {
    const opts = buildOutputOptions(probe({ video: [{ index: 0, codec: "vp9", width: 3840, height: 2160, fps: 24, bitRate: null }], container: "webm", formatName: "matroska,webm" }), ALL, { allowOriginal: true });
    expect(opts.find((o) => o.id === "video:original")!.label).toContain("2160p (4K)");
    expect(opts.find((o) => o.id === "video:remux-mp4")).toBeUndefined(); // VP9 isn't remuxed into MP4 here
  });
  it("uses the shorter side for vertical video", () => {
    const opts = buildOutputOptions(probe({ video: [{ index: 0, codec: "h264", width: 720, height: 1280, fps: 30, bitRate: null }] }), ALL, { allowOriginal: true });
    expect(opts.find((o) => o.id === "video:original")!.resolution).toBe(720);
  });
  it("offers a remux only when codecs fit MP4", () => {
    const mkv = probe({ container: "mkv", formatName: "matroska,webm" });
    expect(findOption(buildOutputOptions(mkv, ALL, { allowOriginal: true }), "video:remux-mp4")).not.toBeNull();
    const mkvVorbis = probe({ container: "mkv", formatName: "matroska,webm", audio: [{ index: 1, codec: "vorbis", channels: 2, sampleRate: 44100, bitRate: null, language: null }] });
    expect(findOption(buildOutputOptions(mkvVorbis, ALL, { allowOriginal: true }), "video:remux-mp4")).toBeNull();
  });
  it("gives exact size only for the original file", () => {
    const opts = buildOutputOptions(probe(), ALL, { allowOriginal: true });
    for (const o of opts) expect(o.exactSizeBytes).toBe(o.operation === "original" ? 1_000_000 : null);
  });
  it("audio-only sources get audio options only; missing encoders remove options", () => {
    const mp3 = probe({ container: "mp3", formatName: "mp3", video: [], audio: [{ index: 0, codec: "mp3", channels: 2, sampleRate: 44100, bitRate: 320000, language: null }] });
    const opts = buildOutputOptions(mp3, { ...ALL, libopus: false }, { allowOriginal: false });
    expect(opts.every((o) => o.kind === "audio")).toBe(true);
    expect(opts.some((o) => o.id.startsWith("audio:opus"))).toBe(false);
    expect(opts.some((o) => o.id === "audio:original")).toBe(false);
  });
});

describe("buildFfmpegPlan", () => {
  const p = probe();
  const opts = buildOutputOptions(p, ALL, { allowOriginal: true });
  it("builds array args with no shell and fixed flags", () => {
    const plan = buildFfmpegPlan(findOption(opts, "audio:mp3-v2")!, p, "/w/in", "/w/out.mp3", "Title; rm -rf / $(x)");
    expect(plan.args).toContain("libmp3lame");
    expect(plan.args[plan.args.indexOf("-q:a") + 1]).toBe("2");
    expect(plan.args).toContain("title=Title; rm -rf / $(x)"); // passed as ONE argv element
    expect(plan.args.at(-1)).toBe("/w/out.mp3");
    expect(plan.expect).toEqual({ formatIncludes: "mp3", videoCodec: null, audioCodec: "mp3", shortSide: null });
  });
  it("scales only downwards", () => {
    const plan = buildFfmpegPlan(findOption(opts, "video:mp4-h264-720")!, p, "/i", "/o.mp4", null);
    expect(plan.args).toContain("scale=-2:720");
    const same = buildFfmpegPlan(findOption(opts, "video:mp4-h264-1080")!, p, "/i", "/o.mp4", null);
    expect(same.args).not.toContain("-vf");
    expect(() => buildFfmpegPlan({ ...findOption(opts, "video:mp4-h264-720")!, id: "video:mp4-h264-2160" }, p, "/i", "/o", null)).toThrow(/upscale/);
  });
  it("refuses unknown option ids", () => {
    expect(() => buildFfmpegPlan({ ...opts[0]!, id: "video:custom" }, p, "/i", "/o", null)).toThrow();
  });
  it("merge args map video from input 0 and audio from input 1", () => {
    const a = buildMergeArgs("/v.mp4", "/a.m4a", "/o.mp4", "mp4");
    expect(a.join(" ")).toContain("-map 0:v:0 -map 1:a:0 -c copy");
  });
});

describe("validateOutputProbe", () => {
  it("accepts a matching output and rejects mismatches", () => {
    const out = probe({ formatName: "mp3", container: "mp3", video: [], audio: [{ index: 0, codec: "mp3", channels: 2, sampleRate: 48000, bitRate: 190000, language: null }], durationSec: 10.05 });
    expect(validateOutputProbe(out, { formatIncludes: "mp3", videoCodec: null, audioCodec: "mp3", shortSide: null }, 10, 1000).ok).toBe(true);
    const bad = validateOutputProbe(out, { formatIncludes: "mp4", videoCodec: "h264", audioCodec: "aac", shortSide: 720 }, 20, 0);
    expect(bad.ok).toBe(false);
    expect(bad.problems.length).toBeGreaterThanOrEqual(4);
  });
});
