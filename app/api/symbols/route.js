import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { createBinanceClient, resolveSymbols } from "@/lib/binance";
import { listSymbols } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const fromStorage = await listSymbols();
  if (fromStorage.length) {
    return NextResponse.json({ symbols: fromStorage });
  }

  const exchange = createBinanceClient();
  try {
    const symbols = await resolveSymbols(exchange, {
      quoteAsset: CONFIG.quoteAsset,
      symbolLimit: CONFIG.symbolLimit,
      requestedSymbols: [],
    });
    return NextResponse.json({ symbols });
  } catch (err) {
    return NextResponse.json(
      { symbols: [], error: err.message || "resolve symbols failed" },
      { status: 500 },
    );
  } finally {
    await exchange.close?.();
  }
}
