import ccxt from "ccxt";

const SYMBOL_CACHE_TTL = 10 * 60 * 1000;
const MARKET_CACHE_TTL = 10 * 60 * 1000;

let cachedSymbols = {
  ts: 0,
  symbols: [],
};

let cachedFallbackSymbols = {
  ts: 0,
  symbols: [],
};

const exchangeMarketCache = new Map();

const EXCHANGE_DEFAULT_OPTIONS = {
  binanceusdm: { defaultType: "future" },
  bybit: { defaultType: "swap" },
  okx: { defaultType: "swap" },
  bitget: { defaultType: "swap" },
  gateio: { defaultType: "swap" },
  kucoinfutures: { defaultType: "swap" },
  mexc: { defaultType: "swap" },
  bingx: { defaultType: "swap" },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

function pickFirstNumber(candidates) {
  for (const value of candidates) {
    const n = parseNumber(value);
    if (n != null) return n;
  }
  return null;
}

function normalizeSymbolKey(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isUsdtLinearSwap(market, quoteAsset) {
  if (!market) return false;
  if (!market.swap || !market.linear) return false;
  if (market.quote !== quoteAsset) return false;
  if (market.settle && market.settle !== quoteAsset) return false;
  if (market.active === false) return false;
  return Boolean(market.base && market.symbol);
}

function toAnchorSymbol(market, quoteAsset) {
  if (!market?.base) return "";
  const settle = market.settle || quoteAsset;
  return `${market.base}/${quoteAsset}:${settle}`;
}

function normalizeBatchPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object") return Object.values(payload);
  return [];
}

function normalizeOi(raw) {
  const info = raw?.info || {};

  const value = pickFirstNumber([
    raw?.openInterestValue,
    raw?.notional,
    raw?.value,
    info?.openInterestValue,
    info?.sumOpenInterestValue,
    info?.open_interest_usd,
    info?.openInterestUsd,
  ]);

  if (value != null) {
    return { oi: value, metric: "value" };
  }

  const amount = pickFirstNumber([
    raw?.openInterestAmount,
    raw?.openInterest,
    raw?.amount,
    info?.openInterest,
    info?.sumOpenInterest,
    info?.open_interest,
  ]);

  if (amount != null) {
    return { oi: amount, metric: "amount" };
  }

  return null;
}

function normalizeSnapshot(anchorSymbol, exchangeId, raw) {
  const parsed = normalizeOi(raw);
  if (!parsed) return null;

  return {
    symbol: anchorSymbol,
    exchange: exchangeId,
    oi: parsed.oi,
    metric: parsed.metric,
    ts: Number(raw?.timestamp) || Date.now(),
  };
}

export function createExchangeClient(exchangeId, { timeoutMs = 20000 } = {}) {
  const ExchangeClass = ccxt?.[exchangeId];
  if (!ExchangeClass) {
    throw new Error(`exchange not supported by ccxt: ${exchangeId}`);
  }

  const options = EXCHANGE_DEFAULT_OPTIONS[exchangeId] || {};

  return new ExchangeClass({
    enableRateLimit: true,
    timeout: timeoutMs,
    options,
  });
}

export function createBinanceClient(options = {}) {
  return createExchangeClient("binanceusdm", options);
}

export async function resolveSymbols(exchange, { quoteAsset, symbolLimit, requestedSymbols = [] }) {
  if (requestedSymbols.length) {
    try {
      await exchange.loadMarkets();
      const verified = requestedSymbols.filter((symbol) => Boolean(exchange.markets?.[symbol]));
      return verified.length ? verified : requestedSymbols;
    } catch {
      return requestedSymbols;
    }
  }

  await exchange.loadMarkets();

  if (cachedSymbols.symbols.length && Date.now() - cachedSymbols.ts < SYMBOL_CACHE_TTL) {
    return symbolLimit > 0 ? cachedSymbols.symbols.slice(0, symbolLimit) : cachedSymbols.symbols;
  }

  const markets = exchange.markets || {};
  const symbols = Object.values(markets)
    .filter((market) => isUsdtLinearSwap(market, quoteAsset))
    .map((market) => market.symbol)
    .sort((a, b) => a.localeCompare(b));

  cachedSymbols = { ts: Date.now(), symbols };

  return symbolLimit > 0 ? symbols.slice(0, symbolLimit) : symbols;
}

export async function resolveSymbolsFromExchanges({
  exchangeIds,
  quoteAsset,
  symbolLimit,
  exchangeTimeoutMs = 20000,
}) {
  if (cachedFallbackSymbols.symbols.length && Date.now() - cachedFallbackSymbols.ts < SYMBOL_CACHE_TTL) {
    return symbolLimit > 0
      ? cachedFallbackSymbols.symbols.slice(0, symbolLimit)
      : cachedFallbackSymbols.symbols;
  }

  const ids = Array.from(new Set((exchangeIds || []).filter(Boolean)));
  const anchorSet = new Set();

  for (const exchangeId of ids) {
    let exchange;
    try {
      exchange = createExchangeClient(exchangeId, { timeoutMs: exchangeTimeoutMs });
      await exchange.loadMarkets();
      const markets = exchange.markets || {};

      for (const market of Object.values(markets)) {
        if (!isUsdtLinearSwap(market, quoteAsset)) continue;
        const anchor = toAnchorSymbol(market, quoteAsset);
        if (anchor) anchorSet.add(anchor);
      }
    } catch {
      // Ignore one exchange failure and continue collecting from others.
    } finally {
      await exchange?.close?.();
    }
  }

  const symbols = Array.from(anchorSet).sort((a, b) => a.localeCompare(b));
  cachedFallbackSymbols = { ts: Date.now(), symbols };

  return symbolLimit > 0 ? symbols.slice(0, symbolLimit) : symbols;
}

export async function resolveExchangeSymbolMap(exchange, anchorSymbols, quoteAsset) {
  const cacheKey = `${exchange.id}:${quoteAsset}`;
  let markets;

  const cached = exchangeMarketCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL) {
    markets = cached.markets;
  } else {
    await exchange.loadMarkets();
    markets = exchange.markets || {};
    exchangeMarketCache.set(cacheKey, { ts: Date.now(), markets });
  }

  const anchorSet = new Set(anchorSymbols);
  const anchorToExchangeSymbol = new Map();

  for (const market of Object.values(markets)) {
    if (!isUsdtLinearSwap(market, quoteAsset)) continue;

    const anchor = toAnchorSymbol(market, quoteAsset);
    if (!anchorSet.has(anchor)) continue;

    if (!anchorToExchangeSymbol.has(anchor)) {
      anchorToExchangeSymbol.set(anchor, market.symbol);
    }
  }

  return anchorToExchangeSymbol;
}

function resolveAnchorFromFetchedSymbol(symbol, reverseSymbolMap, reverseNormalizedMap) {
  if (!symbol) return "";
  if (reverseSymbolMap.has(symbol)) return reverseSymbolMap.get(symbol);

  const normalized = normalizeSymbolKey(symbol);
  return reverseNormalizedMap.get(normalized) || "";
}

async function fetchExchangeSnapshots(
  exchange,
  anchorToExchangeSymbol,
  { fallbackSingleFetchThreshold },
) {
  const exchangeSymbols = Array.from(anchorToExchangeSymbol.values());
  const reverseSymbolMap = new Map();
  const reverseNormalizedMap = new Map();

  for (const [anchor, exchangeSymbol] of anchorToExchangeSymbol.entries()) {
    reverseSymbolMap.set(exchangeSymbol, anchor);
    reverseNormalizedMap.set(normalizeSymbolKey(exchangeSymbol), anchor);
  }

  const snapshotsByAnchor = new Map();
  const failures = [];

  if (!exchangeSymbols.length) {
    return { snapshots: [], failures };
  }

  if (exchange.has?.fetchOpenInterests) {
    let batchPayload;
    try {
      batchPayload = await exchange.fetchOpenInterests(exchangeSymbols);
    } catch (firstError) {
      try {
        batchPayload = await exchange.fetchOpenInterests();
      } catch {
        failures.push({ symbol: "batch", reason: firstError.message || String(firstError) });
      }
    }

    const records = normalizeBatchPayload(batchPayload);
    for (const item of records) {
      const anchor = resolveAnchorFromFetchedSymbol(item?.symbol, reverseSymbolMap, reverseNormalizedMap);
      if (!anchor) continue;
      const snapshot = normalizeSnapshot(anchor, exchange.id, item);
      if (snapshot) snapshotsByAnchor.set(anchor, snapshot);
    }
  }

  const missingAnchors = Array.from(anchorToExchangeSymbol.keys()).filter(
    (anchor) => !snapshotsByAnchor.has(anchor),
  );

  if (!missingAnchors.length || !exchange.has?.fetchOpenInterest) {
    return {
      snapshots: Array.from(snapshotsByAnchor.values()),
      failures,
    };
  }

  if (missingAnchors.length > fallbackSingleFetchThreshold) {
    failures.push({
      symbol: "fallback",
      reason: `missing ${missingAnchors.length} symbols, skip single fetch fallback`,
    });

    return {
      snapshots: Array.from(snapshotsByAnchor.values()),
      failures,
    };
  }

  for (const anchor of missingAnchors) {
    const exchangeSymbol = anchorToExchangeSymbol.get(anchor);
    try {
      const row = await exchange.fetchOpenInterest(exchangeSymbol);
      const snapshot = normalizeSnapshot(anchor, exchange.id, row);
      if (snapshot) {
        snapshotsByAnchor.set(anchor, snapshot);
      } else {
        failures.push({ symbol: anchor, reason: "empty open interest" });
      }
    } catch (err) {
      failures.push({ symbol: anchor, reason: err.message || String(err) });
    }

    await sleep(Math.max(30, exchange.rateLimit || 50));
  }

  return {
    snapshots: Array.from(snapshotsByAnchor.values()),
    failures,
  };
}

export async function fetchAggregatedOpenInterestSnapshots({
  anchorSymbols,
  exchangeIds,
  quoteAsset,
  exchangeTimeoutMs,
  fallbackSingleFetchThreshold,
}) {
  const symbols = Array.from(new Set(anchorSymbols));
  const exchanges = Array.from(new Set(exchangeIds.filter(Boolean)));

  if (!symbols.length || !exchanges.length) {
    return { snapshots: [], failures: [], exchangeStats: [] };
  }

  const aggregateMap = new Map();
  const failures = [];
  const exchangeStats = [];

  for (const exchangeId of exchanges) {
    let exchange;

    try {
      exchange = createExchangeClient(exchangeId, { timeoutMs: exchangeTimeoutMs });

      const anchorToExchangeSymbol = await resolveExchangeSymbolMap(exchange, symbols, quoteAsset);
      const { snapshots, failures: exchangeFailures } = await fetchExchangeSnapshots(
        exchange,
        anchorToExchangeSymbol,
        { fallbackSingleFetchThreshold },
      );

      exchangeStats.push({
        exchange: exchangeId,
        tracked: anchorToExchangeSymbol.size,
        collected: snapshots.length,
        failed: exchangeFailures.length,
      });

      for (const failure of exchangeFailures) {
        failures.push({ exchange: exchangeId, ...failure });
      }

      for (const row of snapshots) {
        if (!aggregateMap.has(row.symbol)) {
          aggregateMap.set(row.symbol, {
            ts: 0,
            valueRows: [],
            amountRows: [],
          });
        }

        const entry = aggregateMap.get(row.symbol);
        entry.ts = Math.max(entry.ts, row.ts);

        if (row.metric === "value") {
          entry.valueRows.push({ exchange: row.exchange, oi: row.oi, metric: row.metric });
        } else {
          entry.amountRows.push({ exchange: row.exchange, oi: row.oi, metric: row.metric });
        }
      }
    } catch (err) {
      failures.push({ exchange: exchangeId, symbol: "*", reason: err.message || String(err) });
      exchangeStats.push({ exchange: exchangeId, tracked: 0, collected: 0, failed: 1 });
    } finally {
      await exchange?.close?.();
    }
  }

  const snapshots = [];

  for (const symbol of symbols) {
    const entry = aggregateMap.get(symbol);
    if (!entry) continue;

    const useValueMetric = entry.valueRows.length > 0;
    const rows = useValueMetric ? entry.valueRows : entry.amountRows;
    if (!rows.length) continue;

    const oi = rows.reduce((sum, row) => sum + row.oi, 0);

    snapshots.push({
      symbol,
      oi,
      metric: useValueMetric ? "value" : "amount",
      ts: entry.ts || Date.now(),
      exchanges: rows,
    });
  }

  return {
    snapshots,
    failures,
    exchangeStats,
  };
}
