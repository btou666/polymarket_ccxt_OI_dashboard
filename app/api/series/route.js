import { NextResponse } from "next/server";
import { readSeries, listSymbols } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 240);

  let symbol = url.searchParams.get("symbol") || "";
  if (!symbol) {
    const symbols = await listSymbols();
    symbol = symbols[0] || "";
  }

  if (!symbol) {
    return NextResponse.json({ symbol: "", points: [], updatedAt: Date.now() });
  }

  try {
    const points = await readSeries(symbol, limit);
    return NextResponse.json({
      symbol,
      points,
      updatedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "read series failed", symbol, points: [] },
      { status: 500 },
    );
  }
}
