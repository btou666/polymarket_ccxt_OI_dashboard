import { NextResponse } from "next/server";
import { collectOpenInterest } from "@/lib/collector";
import { isManualCollectAuthorized } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSymbols(request) {
  const url = new URL(request.url);
  const symbols = [];

  const symbol = url.searchParams.get("symbol");
  if (symbol) symbols.push(symbol);

  const list = url.searchParams.get("symbols");
  if (list) {
    symbols.push(...list.split(","));
  }

  return symbols.map((s) => s.trim()).filter(Boolean);
}

export async function GET(request) {
  if (!isManualCollectAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "manual collect unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await collectOpenInterest({ requestedSymbols: parseSymbols(request) });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "collect failed" },
      { status: 500 },
    );
  }
}
