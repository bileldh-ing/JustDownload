import { NextResponse } from "next/server";
import { workerStatus } from "@/server/worker";

export const dynamic = "force-dynamic";

/** GET /api/v1/health — limited, non-sensitive summary. */
export async function GET() {
  const s = await workerStatus();
  return NextResponse.json({
    web: "ok",
    worker: s.kind === "online" ? (s.health.accepting_jobs ? "online" : "degraded") : s.kind,
    processing_available: s.kind === "online" && s.health.accepting_jobs,
  }, { headers: { "cache-control": "no-store" } });
}
