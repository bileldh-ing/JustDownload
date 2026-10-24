import { NextResponse, type NextRequest } from "next/server";
import { CreateJobRequestSchema, JdError } from "@justdownload/core";
import { assertSameOrigin, clientKey, handle, rateLimit, readJson } from "@/server/http";
import { getSession } from "@/server/session";
import { workerFetch } from "@/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/jobs — create an idempotent job from an inspection and a permitted option. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimit(req, "jobs", 20);
    const parsed = CreateJobRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new JdError("BAD_REQUEST");
    const session = await getSession(false);
    if (!session) throw new JdError("INSPECTION_NOT_FOUND");
    const r = await workerFetch("/v1/jobs", { method: "POST", body: parsed.data, session, client: clientKey(req) });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  });
}
