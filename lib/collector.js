import { CONFIG, getRetentionMs } from "./config.js";
import { appendSnapshots } from "./storage.js";
import { createBinanceClient, fetchOpenInterestSnapshots, resolveSymbols } from "./binance.js";

function parseRequestedSymbols(input = []) {
  return input.map((s) => s.trim()).filter(Boolean);
}

export async function collectOpenInterest({ requestedSymbols = [] } = {}) {
  const exchange = createBinanceClient();

  try {
    const inputSymbols = parseRequestedSymbols(requestedSymbols);
    const preferredSymbols = inputSymbols.length ? inputSymbols : CONFIG.targetSymbols;

    const symbols = await resolveSymbols(exchange, {
      quoteAsset: CONFIG.quoteAsset,
      symbolLimit: CONFIG.symbolLimit,
      requestedSymbols: preferredSymbols,
    });

    const { snapshots, failures } = await fetchOpenInterestSnapshots(exchange, symbols);

    await appendSnapshots(snapshots, {
      retentionMs: getRetentionMs(),
      maxPointsPerSymbol: CONFIG.maxPointsPerSymbol,
    });

    return {
      ok: true,
      at: new Date().toISOString(),
      symbols: symbols.length,
      collected: snapshots.length,
      failed: failures.length,
      failures,
    };
  } finally {
    await exchange.close?.();
  }
}
