import { NextResponse } from "next/server";

import { getEngine } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getEngine().getStatus();
  return NextResponse.json(status);
}
