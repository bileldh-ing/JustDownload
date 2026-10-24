import { NextResponse } from "next/server";
import { toPublicProvider } from "@justdownload/core";
import { webConfig } from "@/server/config";

export const dynamic = "force-dynamic";

/** GET /api/v1/providers — user-visible capability registry (no operational internals). */
export async function GET() {
  return NextResponse.json({ providers: webConfig().registry.map(toPublicProvider) }, { headers: { "cache-control": "public, max-age=300" } });
}
