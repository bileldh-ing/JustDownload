import { NextResponse, type NextRequest } from "next/server";
import { ID_RE, JdError } from "@justdownload/core";
import { assertSameOrigin, clientKey, handle } from "@/server/http";
import { getSession } from "@/server/session";
import { workerFetch } from "@/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/jobs/:id/cancel — request cancellation. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    if (!ID_RE.test(id)) throw new JdError("JOB_NOT_FOUND");
    const session = await getSession(false);
    if (!session) throw new JdError("JOB_NOT_FOUND");
    const r = await workerFetch(`/v1/jobs/${id}/cancel`, { method: "POST", session, client: clientKey(req) });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  });
}
