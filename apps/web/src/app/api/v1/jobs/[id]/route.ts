import { NextResponse, type NextRequest } from "next/server";
import { ID_RE, JdError } from "@justdownload/core";
import { assertSameOrigin, clientKey, handle, rateLimit } from "@/server/http";
import { getSession } from "@/server/session";
import { workerFetch } from "@/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owned(id: string) {
  if (!ID_RE.test(id)) throw new JdError("JOB_NOT_FOUND");
  const session = await getSession(false);
  if (!session) throw new JdError("JOB_NOT_FOUND");
  return session;
}

/** GET /api/v1/jobs/:id — current state and progress (polling fallback for SSE). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    rateLimit(req, "status", 240);
    const { id } = await ctx.params;
    const session = await owned(id);
    const r = await workerFetch(`/v1/jobs/${id}`, { session, client: clientKey(req) });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  });
}

/** DELETE /api/v1/jobs/:id — delete the job and its artifact (owner only). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const session = await owned(id);
    const r = await workerFetch(`/v1/jobs/${id}`, { method: "DELETE", session, client: clientKey(req) });
    return r.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(r.body, { status: r.status });
  });
}
