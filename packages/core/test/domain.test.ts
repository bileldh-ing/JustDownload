import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASE_PROVIDER_REGISTRY, CreateJobRequestSchema, FfmpegProgressParser, IllegalTransitionError, JOB_STATES, JdError, RateMeter, TERMINAL_STATES,
  allowsDownload, assertDownloadAllowed, assertTransition, buildOutputFilename, buildRegistry, canTransition, clampStagePercent, contentDisposition,
  conversionPercent, errorBody, formatBytes, formatDuration, parsePolicyOverrides, resolveProvider, sanitizeBaseName, sniffContainer, toPublicProvider, validateRequestedFilename,
} from "../src";

describe("provider registry", () => {
  const reg = buildRegistry();
  it("routes platform hosts (and subdomains) to their policy", () => {
    expect(resolveProvider("www.youtube.com", reg).id).toBe("youtube");
    expect(resolveProvider("youtu.be", reg).id).toBe("youtube");
    expect(resolveProvider("m.facebook.com", reg).id).toBe("facebook");
    expect(resolveProvider("evilyoutube.com", reg).id).toBe("direct_media");
    expect(resolveProvider("cdn.example.org", reg).id).toBe("direct_media");
  });
  it("treats archive.org item pages and direct download paths differently", () => {
    expect(resolveProvider({ hostname: "archive.org", pathname: "/details/foo" }, reg).id).toBe("internet_archive_page");
    expect(resolveProvider({ hostname: "archive.org", pathname: "/download/foo/foo.mp4" }, reg).id).toBe("direct_media");
  });
  it("never allows downloads from restricted platforms by default", () => {
    for (const id of ["youtube", "facebook", "instagram", "tiktok", "x", "vimeo", "soundcloud"]) {
      const p = reg.find((r) => r.id === id)!;
      expect(allowsDownload(p)).toBe(false);
      expect(() => assertDownloadAllowed(p)).toThrow(JdError);
    }
    expect(allowsDownload(reg.find((r) => r.id === "direct_media")!)).toBe(true);
  });
  it("every entry has docs, a review date and a reason", () => {
    for (const p of BASE_PROVIDER_REGISTRY) {
      expect(p.docsUrl).toMatch(/^https:\/\//);
      expect(p.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.reason.length).toBeGreaterThan(20);
    }
  });
  it("server overrides can't enable a platform without an approved extractor, and can't add providers", () => {
    expect(() => buildRegistry({ youtube: { download: "enabled" } })).toThrow(/approved_extractor/);
    const r = buildRegistry({ youtube: { download: "enabled", metadataMethod: "approved_extractor" }, madeup: { download: "enabled" } });
    expect(r.find((p) => p.id === "youtube")!.download).toBe("enabled");
    expect(r.find((p) => p.id === "madeup")).toBeUndefined();
    expect(() => buildRegistry({ direct_media: { download: "bogus" as never } })).toThrow();
  });
  it("outage status blocks downloads with a retryable error", () => {
    const r = buildRegistry({ direct_media: { status: "outage" } });
    try { assertDownloadAllowed(r.find((p) => p.id === "direct_media")!); } catch (e) { expect((e as JdError).code).toBe("PROVIDER_UNAVAILABLE"); }
  });
  it("parses overrides JSON strictly", () => {
    expect(parsePolicyOverrides(undefined)).toEqual({});
    expect(() => parsePolicyOverrides("[]")).toThrow();
  });
  it("public projection exposes no operational limits", () => {
    const pub = toPublicProvider(reg[0]!);
    expect(pub).not.toHaveProperty("limits");
  });
});

describe("job request schema", () => {
  it("rejects unknown keys so clients can't force policy", () => {
    const r = CreateJobRequestSchema.safeParse({ inspection_id: "a".repeat(24), option_id: "audio:mp3-v0", provider_capability: "enabled" });
    expect(r.success).toBe(false);
  });
  it("rejects malformed option ids and inspection ids", () => {
    expect(CreateJobRequestSchema.safeParse({ inspection_id: "../../etc", option_id: "audio:mp3-v0" }).success).toBe(false);
    expect(CreateJobRequestSchema.safeParse({ inspection_id: "a".repeat(24), option_id: "-vf;rm -rf /" }).success).toBe(false);
  });
});

describe("job state machine", () => {
  it("allows the happy path", () => {
    const path = ["created", "validating", "queued", "downloading", "converting", "validating_output", "ready", "expired"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });
  it("forbids skipping validation and leaving terminal states", () => {
    expect(canTransition("converting", "ready")).toBe(false);
    expect(canTransition("downloading", "ready")).toBe(false);
    expect(() => assertTransition("ready", "downloading")).toThrow(IllegalTransitionError);
    for (const t of TERMINAL_STATES) for (const s of JOB_STATES) if (s !== "expired") expect(canTransition(t, s)).toBe(false);
  });
  it("only reports 100% for ready jobs", () => {
    expect(clampStagePercent("converting", 100)).toBe(99);
    expect(clampStagePercent("validating_output", null)).toBeNull();
    expect(clampStagePercent("ready", null)).toBe(100);
  });
});

describe("filenames", () => {
  it("sanitises traversal, reserved names and control characters", () => {
    expect(buildOutputFilename("../../etc/passwd", null as never, "mp3")).toBe("etc passwd.mp3");
    expect(buildOutputFilename("CON", undefined, "mp4")).toBe("CON_file.mp4");
    expect(buildOutputFilename("song\u202e3pm.exe", undefined, "mp3")).toBe("song3pm.exe.mp3");
    expect(buildOutputFilename("My clip.mp4", undefined, "mp3")).toBe("My clip.mp3");
    expect(buildOutputFilename(undefined, "Café — live", "m4a")).toBe("Café — live.m4a");
    expect(buildOutputFilename(undefined, undefined, "wav")).toBe("JustDownload media.wav");
    expect(() => buildOutputFilename("////", undefined, "mp3")).toThrow(JdError);
  });
  it("validates requested names", () => {
    expect(() => validateRequestedFilename("a/b")).toThrow(JdError);
    expect(() => validateRequestedFilename("ok name")).not.toThrow();
  });
  it("produces RFC 5987 Content-Disposition with ASCII fallback", () => {
    expect(contentDisposition("Café \"x\".mp3")).toBe(`attachment; filename="Cafe _x_.mp3"; filename*=UTF-8''Caf%C3%A9%20%22x%22.mp3`);
  });
  it("fuzz: output never contains separators or control chars and stays bounded", () => {
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 400 }), (s) => {
      const out = sanitizeBaseName(s);
      expect(out).not.toMatch(/[\\/\u0000-\u001f]/);
      expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(120);
      expect(out.startsWith(".")).toBe(false);
    }), { numRuns: 2000 });
  });
});

describe("sniffContainer", () => {
  const b = (...xs: number[]) => new Uint8Array(xs);
  const s = (str: string) => new TextEncoder().encode(str);
  it("identifies common containers", () => {
    expect(sniffContainer(new Uint8Array([0, 0, 0, 0x20, ...s("ftypisom")])).container).toBe("mp4");
    expect(sniffContainer(new Uint8Array([0, 0, 0, 0x20, ...s("ftypM4A ")])).container).toBe("m4a");
    expect(sniffContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...s("....webm")])).container).toBe("webm");
    expect(sniffContainer(s("ID3\u0004")).container).toBe("mp3");
    expect(sniffContainer(new Uint8Array([...s("RIFF"), 0, 0, 0, 0, ...s("WAVE")])).container).toBe("wav");
    expect(sniffContainer(s("OggS")).container).toBe("ogg");
    expect(sniffContainer(b(0xff, 0xfb, 0x90)).container).toBe("mp3");
  });
  it("flags manifests and documents", () => {
    expect(sniffContainer(s("#EXTM3U\n#EXT-X-VERSION:3")).kind).toBe("manifest");
    expect(sniffContainer(s("<!DOCTYPE html><html>")).kind).toBe("document");
    expect(sniffContainer(s("%PDF-1.7")).kind).toBe("document");
    expect(sniffContainer(b(1, 2, 3)).kind).toBe("unknown");
  });
});

describe("progress", () => {
  it("parses ffmpeg -progress blocks", () => {
    const p = new FfmpegProgressParser();
    expect(p.push("out_time_us=1500000")).toBeNull();
    p.push("speed=2.5x");
    const snap = p.push("progress=continue")!;
    expect(snap.outTimeSec).toBe(1.5);
    expect(snap.speed).toBe(2.5);
    expect(snap.done).toBe(false);
    p.push("out_time=00:00:03.000000");
    p.push("out_time_us=N/A");
    expect(p.push("progress=end")!).toMatchObject({ outTimeSec: 3, done: true });
  });
  it("returns null percent when duration is unknown", () => {
    expect(conversionPercent(10, null)).toBeNull();
    expect(conversionPercent(5, 10)).toBe(50);
    expect(conversionPercent(20, 10)).toBe(99);
  });
  it("measures rate only with enough samples", () => {
    const m = new RateMeter();
    m.add(0, 0);
    expect(m.speed()).toBeNull();
    m.add(1000, 1000);
    expect(m.speed()).toBe(1000);
    expect(m.eta(5000, 1000)).toBe(4);
    expect(m.eta(null, 1000)).toBeNull();
  });
});

describe("errors and formatting", () => {
  it("never leaks internal details", () => {
    const { status, body } = errorBody(new JdError("UNSAFE_DESTINATION", { internal: "10.0.0.1" }), "req1");
    expect(status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    expect(errorBody(new Error("boom /etc/x"), "r").body.error.code).toBe("INTERNAL");
  });
  it("formats sizes and durations", () => {
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(null)).toBe("unknown size");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("unknown length");
  });
});
