import { NextRequest, NextResponse } from "next/server";

import { getEngine } from "@/lib/trading/engine";
import type { RiskConfig } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getEngine().getConfig());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as RiskConfig | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const saved = getEngine().setConfig(body);
  return NextResponse.json(saved);
}
