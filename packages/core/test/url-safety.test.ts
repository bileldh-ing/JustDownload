import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { JdError, classifyIp, normalizeUrl, redactUrl } from "../src";

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof JdError ? e.code : `non-jd:${String(e)}`;
  }
}

describe("normalizeUrl", () => {
  it("accepts and canonicalises public https URLs", () => {
    const u = normalizeUrl("  https://Example.COM/media/clip.mp4?sig=abc#frag ");
    expect(u.hostname).toBe("example.com");
    expect(u.href).toBe("https://example.com/media/clip.mp4?sig=abc");
    expect(u.port).toBe(443);
    expect(u.redacted).toBe("https://example.com/media/clip.mp4?[redacted]");
  });

  it("assumes https when the scheme is missing", () => {
    expect(normalizeUrl("example.com/a.mp3").href).toBe("https://example.com/a.mp3");
  });

  it.each(["file:///etc/passwd", "ftp://example.com/a.mp4", "gopher://example.com", "data:video/mp4;base64,AAAA", "javascript:alert(1)", "chrome://settings", "ws://example.com"])(
    "rejects scheme %s", (u) => {
      expect(code(() => normalizeUrl(u))).toBe("UNSUPPORTED_SCHEME");
    });

  it("rejects embedded credentials", () => {
    expect(code(() => normalizeUrl("https://user:pass@example.com/a.mp4"))).toBe("URL_CREDENTIALS_NOT_ALLOWED");
    expect(code(() => normalizeUrl("https://user@example.com/a.mp4"))).toBe("URL_CREDENTIALS_NOT_ALLOWED");
  });

  it.each([
    "http://127.0.0.1/", "http://localhost/", "http://LOCALHOST./", "http://foo.localhost/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.3.4/",
    "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[fe80::1]/", "http://[fd00::1]/",
    "http://0.0.0.0/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/", "http://100.64.0.1/", "http://224.0.0.1/",
    "http://metadata.google.internal/", "http://printer.local/", "http://intranet/", "http://redis/", "http://[::]/", "http://192.0.2.1/", "http://[64:ff9b::7f00:1]/", "http://[2002:7f00:1::]/",
  ])("blocks private/reserved destination %s", (u) => {
    expect(["UNSAFE_DESTINATION", "INVALID_URL"]).toContain(code(() => normalizeUrl(u)));
  });

  it("blocks non-standard ports by default and allows them when configured", () => {
    expect(code(() => normalizeUrl("https://example.com:8443/a.mp4"))).toBe("PORT_NOT_ALLOWED");
    expect(code(() => normalizeUrl("http://example.com:22/"))).toBe("PORT_NOT_ALLOWED");
    expect(normalizeUrl("https://example.com:8443/a.mp4", { allowedPorts: [443, 8443] }).port).toBe(8443);
  });

  it("converts IDNs to punycode before checking", () => {
    expect(normalizeUrl("https://bücher.example/a.mp4").hostname).toBe("xn--bcher-kva.example");
  });

  it("rejects control characters, whitespace and oversized input", () => {
    expect(code(() => normalizeUrl("https://exa mple.com/"))).toBe("INVALID_URL");
    expect(code(() => normalizeUrl("https://example.com/\n"))).toBe(null); // trailing whitespace is trimmed
    expect(code(() => normalizeUrl("https://example.com/a\u0000b"))).toBe("INVALID_URL");
    expect(code(() => normalizeUrl(`https://example.com/${"a".repeat(5000)}`))).toBe("INVALID_URL");
    expect(code(() => normalizeUrl(""))).toBe("INVALID_URL");
  });

  it("allows loopback only with the explicit test flag", () => {
    expect(normalizeUrl("http://127.0.0.1:45678/x.mp4", { allowPrivateNetwork: true }).hostname).toBe("127.0.0.1");
  });

  it("fuzz: never throws a non-JdError and never returns a private destination", () => {
    fc.assert(fc.property(fc.oneof(fc.webUrl(), fc.string(), fc.ipV4().map((ip) => `http://${ip}/`), fc.ipV6().map((ip) => `http://[${ip}]/`)), (s) => {
      try {
        const u = normalizeUrl(s);
        if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) expect(classifyIp(u.hostname)).toBe("public");
      } catch (e) {
        expect(e).toBeInstanceOf(JdError);
      }
    }), { numRuns: 1500 });
  });
});

describe("classifyIp", () => {
  it.each([
    ["8.8.8.8", "public"], ["1.1.1.1", "public"], ["2606:4700:4700::1111", "public"], ["127.0.0.1", "loopback"], ["10.1.2.3", "private"],
    ["169.254.169.254", "metadata"], ["169.254.1.1", "link_local"], ["::ffff:10.0.0.1", "private"], ["fd00:ec2::254", "metadata"], ["100.64.1.1", "carrier_nat"], ["not-an-ip", "reserved"],
  ])("%s → %s", (ip, cls) => {
    expect(classifyIp(ip)).toBe(cls);
  });
});

describe("redactUrl", () => {
  it("drops query strings and credentials", () => {
    expect(redactUrl("https://u:p@cdn.example.com/v.mp4?token=secret")).toBe("https://cdn.example.com/v.mp4?[redacted]");
    expect(redactUrl("nope")).toBe("[invalid-url]");
  });
});
