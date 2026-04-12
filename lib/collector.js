import { CONFIG, getRetentionMs } from "./config.js";
import { appendSnapshots, listSymbols } from "./storage.js";
import {
  createBinanceClient,
  fetchAggregatedOpenInterestSnapshots,
  resolveSymbols,
} from "./binance.js";

function parseRequestedSymbols(input = []) {
  return input.map((s) => s.trim()).filter(Boolean);
}

export async function collectOpenInterest({ requestedSymbols = [] } = {}) {
  const exchange = createBinanceClient({ timeoutMs: CONFIG.exchangeTimeoutMs });

  try {
    const inputSymbols = parseRequestedSymbols(requestedSymbols);
    const preferredSymbols = inputSymbols.length ? inputSymbols : CONFIG.targetSymbols;

    let symbols = [];
    try {
      symbols = await resolveSymbols(exchange, {
        quoteAsset: CONFIG.quoteAsset,
        symbolLimit: CONFIG.symbolLimit,
        requestedSymbols: preferredSymbols,
      });
    } catch (err) {
      const stored = await listSymbols();
      if (!stored.length) {
        throw err;
      }
      symbols = stored;
    }

    if (!symbols.length) {
      throw new Error("no symbols resolved for aggregation");
    }

    const { snapshots, failures, exchangeStats } = await fetchAggregatedOpenInterestSnapshots({
      anchorSymbols: symbols,
      exchangeIds: CONFIG.aggExchanges,
      quoteAsset: CONFIG.quoteAsset,
      exchangeTimeoutMs: CONFIG.exchangeTimeoutMs,
      fallbackSingleFetchThreshold: CONFIG.fallbackSingleFetchThreshold,
    });

    await appendSnapshots(snapshots, {
      retentionMs: getRetentionMs(),
      maxPointsPerSymbol: CONFIG.maxPointsPerSymbol,
    });

    return {
      ok: true,
      at: new Date().toISOString(),
      symbols: symbols.length,
      collected: snapshots.length,
      exchanges: CONFIG.aggExchanges.length,
      failed: failures.length,
      exchangeStats,
      failures,
    };
  } finally {
    await exchange.close?.();
  }
}
