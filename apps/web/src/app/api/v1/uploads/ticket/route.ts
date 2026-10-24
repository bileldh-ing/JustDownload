import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, clientKey, handle, rateLimit } from "@/server/http";
import { getSession } from "@/server/session";
import { workerFetch } from "@/server/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads/ticket — get a short-lived, single-use signed URL so the browser can upload a
 * local file straight to the worker (large files never pass through this serverless function).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    rateLimit(req, "upload", 10);
    const session = (await getSession(true))!;
    const r = await workerFetch("/v1/uploads/ticket", { method: "POST", session, client: clientKey(req) });
    return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  });
}
