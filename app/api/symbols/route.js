import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { createBinanceClient, resolveSymbols } from "@/lib/binance";
import { listSymbols } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["hkg1", "sin1", "hnd1"];

function formatSymbolsError(err) {
  const message = err?.message || "resolve symbols failed";
  const isRestricted =
    /restricted location/i.test(message) ||
    /service unavailable/i.test(message) ||
    /forbidden/i.test(message) ||
    /451/.test(message);

  if (!isRestricted) return message;
  return `${message}；Binance 在当前运行地域可能受限，请改用亚洲区域函数或自建服务器。`;
}

export async function GET() {
  const fromStorage = await listSymbols();
  if (fromStorage.length) {
    return NextResponse.json({ symbols: fromStorage });
  }

  if (CONFIG.targetSymbols.length) {
    return NextResponse.json({ symbols: CONFIG.targetSymbols, source: "env" });
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
      { symbols: [], error: formatSymbolsError(err) },
      { status: 500 },
    );
  } finally {
    await exchange.close?.();
  }
}
