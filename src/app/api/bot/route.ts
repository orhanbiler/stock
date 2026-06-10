import { NextRequest, NextResponse } from "next/server";

import { getEngine } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { action } = (await req.json().catch(() => ({}))) as {
    action?: string;
  };
  const engine = getEngine();

  switch (action) {
    case "start":
      engine.start();
      break;
    case "stop":
      engine.stop();
      break;
    case "flatten":
      engine.stop();
      await engine.flattenAll("Manual flatten — all positions closed");
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const status = await engine.getStatus();
  return NextResponse.json(status);
}
