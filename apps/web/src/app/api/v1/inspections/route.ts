import { NextResponse, type NextRequest } from "next/server";
import { InspectRequestSchema, JdError } from "@justdownload/core";
import { basicInspect } from "@justdownload/core/node";
import { webConfig, workerConfigured } from "@/server/config";
import { assertSameOrigin, clientKey, handle, rateLimit, readJson } from "@/server/http";
import { getSession } from "@/server/session";
import { workerFetch } from "@/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/inspections — validate and inspect a URL under the server-side policy registry.
 * With a worker: full FFprobe inspection on the worker. Without one: basic, SSRF-safe probe of the
 * first 64 KB (no codecs/duration, no download options), clearly labelled as such.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimit(req, "inspect");
    const parsed = InspectRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new JdError("BAD_REQUEST");
    const session = (await getSession(true))!;
    if (workerConfigured()) {
      const r = await workerFetch("/v1/inspections", { method: "POST", body: parsed.data, session, client: clientKey(req), timeoutMs: 55_000 });
      return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
    }
    const cfg = webConfig();
    const view = await basicInspect(parsed.data.url, cfg.registry, { allowPrivateNetwork: cfg.allowPrivateNetwork, timeoutMs: 10_000 });
    return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
  });
}
