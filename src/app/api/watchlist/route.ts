import { NextRequest, NextResponse } from "next/server";

import { getEngine } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ symbols: getEngine().getSymbols() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    symbols?: unknown;
  } | null;
  const saved = getEngine().setSymbols(body?.symbols);
  if (!saved) {
    return NextResponse.json(
      { error: "Provide 1–20 valid ticker symbols" },
      { status: 400 }
    );
  }
  return NextResponse.json({ symbols: saved });
}
