import { NextResponse } from "next/server";

import { getEngine } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";

/** Lightweight liveness probe for Railway/Fly health checks — no tick. */
export async function GET() {
  const engine = getEngine();
  return NextResponse.json({
    ok: true,
    mode: engine.getMode(),
    running: engine.isRunning(),
    time: new Date().toISOString(),
  });
}
