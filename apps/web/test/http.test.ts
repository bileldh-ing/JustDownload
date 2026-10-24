import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { JdError } from "@justdownload/core";
import { assertSameOrigin, clientKey, jsonError, rateLimit } from "@/server/http";

function req(headers: Record<string, string>) {
  return new NextRequest("https://justdownload.example/api/v1/jobs", { method: "POST", headers });
}

describe("web API guards", () => {
  it("rejects cross-site state changes (CSRF)", () => {
    expect(() => assertSameOrigin(req({ host: "justdownload.example", origin: "https://evil.example" }))).toThrow(JdError);
    expect(() => assertSameOrigin(req({ host: "justdownload.example", "sec-fetch-site": "cross-site" }))).toThrow(JdError);
    expect(() => assertSameOrigin(req({ host: "justdownload.example", origin: "https://justdownload.example", "sec-fetch-site": "same-origin" }))).not.toThrow();
  });
  it("rate limits per client", () => {
    const r = req({ "x-forwarded-for": "203.0.113.9" });
    for (let i = 0; i < 3; i++) rateLimit(r, "t", 3);
    expect(() => rateLimit(r, "t", 3)).toThrow(/Too many/);
    expect(clientKey(r)).not.toContain("203.0.113.9");
  });
  it("returns the standard error schema without internals", async () => {
    const res = jsonError(new JdError("UNSAFE_DESTINATION", { internal: "10.1.2.3" }), "rid");
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({ error: { code: "UNSAFE_DESTINATION", message: expect.any(String), request_id: "rid", retryable: false, action: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("10.1.2.3");
  });
});
