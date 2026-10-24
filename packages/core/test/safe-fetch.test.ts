import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRegistry, JdError } from "../src";
import { basicInspect, readPrefix, safeFetch, signCapability, verifyCapability } from "../src/node";

let server: http.Server;
let base = "";
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/clip.mp3") {
      res.writeHead(206, { "content-type": "audio/mpeg", "content-range": "bytes 0-9/5000", "accept-ranges": "bytes" });
      return res.end(Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"));
    }
    if (req.url === "/page") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><html><head></head></html>"); }
    if (req.url === "/playlist") { res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }); return res.end("#EXTM3U\n"); }
    if (req.url === "/to-metadata") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (req.url === "/to-file-scheme") { res.writeHead(302, { location: "file:///etc/passwd" }); return res.end(); }
    if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
    if (req.url === "/to-clip") { res.writeHead(301, { location: "/clip.mp3" }); return res.end(); }
    if (req.url === "/missing") { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end("x");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const TEST = { allowPrivateNetwork: true } as const;

describe("safeFetch", () => {
  it("refuses loopback without the test flag (no request is made)", async () => {
    await expect(safeFetch(`${base}/clip.mp3`)).rejects.toMatchObject({ code: expect.stringMatching(/UNSAFE_DESTINATION|PORT_NOT_ALLOWED/) });
  });
  it("refuses hostnames whose DNS answer contains any private address (rebinding)", async () => {
    const resolver = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
    await expect(safeFetch("https://media.example.com/a.mp4", { resolver })).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    await expect(safeFetch("https://media.example.com/a.mp4", { resolver: async () => [{ address: "::ffff:10.0.0.8", family: 6 }] })).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
  });
  it("maps DNS failures to a typed error", async () => {
    await expect(safeFetch("https://media.example.com/a.mp4", { resolver: async () => { throw new Error("ENOTFOUND"); } })).rejects.toMatchObject({ code: "DNS_RESOLUTION_FAILED" });
  });
  it("connects to the pinned validated address (ignores the hostname's real DNS)", async () => {
    // "fixture.example" doesn't exist; the resolver pins it to the local test server.
    const res = await safeFetch(`http://fixture.example:${port}/clip.mp3`, { ...TEST, resolver: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(res.status).toBe(206);
    const buf = await readPrefix(res.body, 100);
    expect(buf.subarray(0, 3).toString()).toBe("ID3");
  });
  it("blocks redirects into metadata endpoints and other schemes even when the first hop is allowed", async () => {
    await expect(safeFetch(`${base}/to-metadata`, TEST)).rejects.toMatchObject({ code: "UNSAFE_REDIRECT" });
    await expect(safeFetch(`${base}/to-file-scheme`, TEST)).rejects.toMatchObject({ code: "UNSAFE_REDIRECT" });
  });
  it("caps redirect chains", async () => {
    await expect(safeFetch(`${base}/loop`, { ...TEST, maxRedirects: 3 })).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });
  it("follows safe redirects and reports the count", async () => {
    const res = await safeFetch(`${base}/to-clip`, TEST);
    res.body.resume();
    expect(res.status).toBe(206);
    expect(res.redirects).toBe(1);
  });
});

describe("basicInspect", () => {
  const reg = buildRegistry();
  it("reports what the server returns without inventing media details", async () => {
    const v = await basicInspect(`${base}/clip.mp3`, reg, TEST);
    expect(v.mode).toBe("basic");
    expect(v.basic).toMatchObject({ content_type: "audio/mpeg", content_length: 5000, accept_ranges: true, sniffed_container: "mp3" });
    expect(v.media).toBeNull();
    expect(v.options).toEqual([]);
  });
  it("rejects web pages and streaming playlists", async () => {
    await expect(basicInspect(`${base}/page`, reg, TEST)).rejects.toMatchObject({ code: "SOURCE_NOT_MEDIA" });
    await expect(basicInspect(`${base}/playlist`, reg, TEST)).rejects.toMatchObject({ code: "STREAMING_MANIFEST_UNSUPPORTED" });
    await expect(basicInspect(`${base}/missing`, reg, TEST)).rejects.toMatchObject({ code: "SOURCE_HTTP_ERROR" });
  });
  it("does not touch the network for restricted platforms", async () => {
    const v = await basicInspect("https://www.youtube.com/watch?v=abc", reg, { resolver: async () => { throw new Error("must not resolve"); } } as never);
    expect(v.mode).toBe("policy");
    expect(v.download_allowed).toBe(false);
    expect(v.provider.officialRoute?.url).toMatch(/^https:/);
  });
  it("throws JdError for unsafe input", async () => {
    await expect(basicInspect("http://169.254.169.254/", reg)).rejects.toBeInstanceOf(JdError);
  });
});

describe("capability signatures", () => {
  it("verifies, expires and rejects tampering", () => {
    const { exp, sig } = signCapability("s3cret", "download", "job1", 60, 1_000_000);
    expect(verifyCapability("s3cret", "download", "job1", exp, sig, 1_000_000)).toBe("ok");
    expect(verifyCapability("s3cret", "download", "job2", exp, sig, 1_000_000)).toBe("invalid");
    expect(verifyCapability("other", "download", "job1", exp, sig, 1_000_000)).toBe("invalid");
    expect(verifyCapability("s3cret", "upload", "job1", exp, sig, 1_000_000)).toBe("invalid");
    expect(verifyCapability("s3cret", "download", "job1", exp, sig, 1_000_000 + 61_000)).toBe("expired");
    expect(verifyCapability("s3cret", "download", "job1", undefined, sig)).toBe("invalid");
  });
});
