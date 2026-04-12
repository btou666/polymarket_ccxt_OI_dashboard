import { CONFIG, getRetentionMs } from "./config.js";
import { appendSnapshots, listSymbols, saveCollectStats } from "./storage.js";
import {
  createBinanceClient,
  fetchAggregatedOpenInterestSnapshots,
  resolveSymbols,
  resolveSymbolsFromExchanges,
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
      try {
        const fallbackSymbols = await resolveSymbolsFromExchanges({
          exchangeIds: CONFIG.aggExchanges,
          quoteAsset: CONFIG.quoteAsset,
          symbolLimit: CONFIG.symbolLimit,
          exchangeTimeoutMs: CONFIG.exchangeTimeoutMs,
        });
        if (fallbackSymbols.length) {
          symbols = fallbackSymbols;
        } else {
          const stored = await listSymbols();
          if (!stored.length) {
            throw err;
          }
          symbols = stored;
        }
      } catch {
        throw err;
      }
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

    const result = {
      ok: true,
      at: new Date().toISOString(),
      symbols: symbols.length,
      collected: snapshots.length,
      exchanges: CONFIG.aggExchanges.length,
      failed: failures.length,
      exchangeStats,
      failures,
    };

    try {
      await saveCollectStats(result);
    } catch {
      // Ignore debug stats persistence errors to keep collection path healthy.
    }

    return result;
  } finally {
    await exchange.close?.();
  }
}
