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

function addNormalizedAlias(map, candidate, anchor) {
  const key = normalizeSymbolKey(candidate);
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, anchor);
  }
}

function buildAliasCandidates(exchangeSymbol, market) {
  const candidates = [exchangeSymbol, market?.symbol, market?.id, market?.info?.symbol, market?.info?.instId];

  if (typeof exchangeSymbol === "string" && exchangeSymbol.includes(":")) {
    candidates.push(exchangeSymbol.split(":")[0]);
  }

  const base = market?.base || market?.info?.baseCurrency || market?.info?.base || "";
  const quote = market?.quote || market?.info?.quoteCurrency || market?.info?.quote || "";
  const settle = market?.settle || market?.info?.settleCurrency || market?.info?.settle || "";

  if (base && quote) {
    candidates.push(`${base}/${quote}`);
    candidates.push(`${base}${quote}`);
    if (settle) {
      candidates.push(`${base}/${quote}:${settle}`);
      candidates.push(`${base}${quote}${settle}`);
    }
  }

  return candidates.filter(Boolean);
}

function median(values) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
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
    return { oi: value, metric: "value", source: "value" };
  }

  const amountCandidates = [
    ["openInterestAmount", raw?.openInterestAmount],
    ["openInterest", raw?.openInterest],
    ["amount", raw?.amount],
    ["info.openInterest", info?.openInterest],
    ["info.sumOpenInterest", info?.sumOpenInterest],
    ["info.open_interest", info?.open_interest],
  ];

  let amount = null;
  let source = "";
  for (const [candidateSource, candidateValue] of amountCandidates) {
    const n = parseNumber(candidateValue);
    if (n != null) {
      amount = n;
      source = candidateSource;
      break;
    }
  }

  if (amount != null) {
    return { oi: amount, metric: "amount", source };
  }

  return null;
}

function extractPriceHint(raw) {
  const info = raw?.info || {};
  return pickFirstNumber([
    raw?.markPrice,
    raw?.indexPrice,
    raw?.lastPrice,
    raw?.price,
    info?.markPrice,
    info?.indexPrice,
    info?.lastPrice,
    info?.price,
  ]);
}

function normalizeSnapshot(anchorSymbol, exchangeId, raw, market = null) {
  const parsed = normalizeOi(raw);
  if (!parsed) return null;

  let oi = parsed.oi;
  let contractAdjusted = false;

  // KuCoin futures often returns open interest in contracts.
  // Convert to base amount using contractSize to avoid 10x/100x inflation.
  if (exchangeId === "kucoinfutures" && parsed.metric === "amount") {
    const contractSize = parseNumber(market?.contractSize);
    if (contractSize && contractSize > 0) {
      oi = oi * contractSize;
      contractAdjusted = true;
    }
  }

  return {
    symbol: anchorSymbol,
    exchange: exchangeId,
    oi,
    metric: parsed.metric,
    source: parsed.source,
    contractAdjusted,
    price: extractPriceHint(raw),
    ts: Number(raw?.timestamp) || Date.now(),
  };
}

function chunkList(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

function resolveAnchorFromFetchedRow(row, reverseSymbolMap, reverseNormalizedMap) {
  const info = row?.info || {};
  const candidates = [
    row?.symbol,
    row?.id,
    row?.marketId,
    info?.symbol,
    info?.instId,
    info?.contract,
    info?.pair,
    info?.currency_pair,
    info?.symbolName,
    info?.s,
  ];

  const base = row?.base || info?.baseCurrency || info?.base || "";
  const quote = row?.quote || info?.quoteCurrency || info?.quote || "";
  const settle = row?.settle || info?.settleCurrency || info?.settle || "";
  if (base && quote) {
    candidates.push(`${base}/${quote}`);
    candidates.push(`${base}${quote}`);
    if (settle) {
      candidates.push(`${base}/${quote}:${settle}`);
      candidates.push(`${base}${quote}${settle}`);
    }
  }

  for (const candidate of candidates) {
    const anchor = resolveAnchorFromFetchedSymbol(candidate, reverseSymbolMap, reverseNormalizedMap);
    if (anchor) return anchor;
  }

  return "";
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
    const market = exchange.markets?.[exchangeSymbol] || null;
    const aliases = buildAliasCandidates(exchangeSymbol, market);
    for (const alias of aliases) {
      addNormalizedAlias(reverseNormalizedMap, alias, anchor);
    }
  }

  const snapshotsByAnchor = new Map();
  const failures = [];

  if (!exchangeSymbols.length) {
    return { snapshots: [], failures };
  }

  if (typeof exchange.fetchOpenInterests === "function") {
    let records = [];
    let batchFailed = false;
    const chunkSizeByExchange = {
      binanceusdm: 200,
      bybit: 80,
      okx: 120,
      bitget: 80,
      gateio: 80,
      kucoinfutures: 80,
      mexc: 80,
      bingx: 80,
    };
    const chunkSize = chunkSizeByExchange[exchange.id] || 100;

    try {
      const symbolChunks = chunkList(exchangeSymbols, chunkSize);
      for (const symbolsChunk of symbolChunks) {
        try {
          const payload = await exchange.fetchOpenInterests(symbolsChunk);
          records.push(...normalizeBatchPayload(payload));
        } catch (chunkErr) {
          batchFailed = true;
          failures.push({
            symbol: "batch",
            reason: `chunk(${symbolsChunk.length}) failed: ${chunkErr.message || String(chunkErr)}`,
          });
        }
        await sleep(Math.max(20, exchange.rateLimit || 50));
      }

      if (!records.length) {
        const payload = await exchange.fetchOpenInterests();
        records = normalizeBatchPayload(payload);
      }
    } catch (batchErr) {
      batchFailed = true;
      failures.push({ symbol: "batch", reason: batchErr.message || String(batchErr) });
    }

    for (const item of records) {
      const anchor = resolveAnchorFromFetchedRow(item, reverseSymbolMap, reverseNormalizedMap);
      if (!anchor) continue;
      const exchangeSymbol = anchorToExchangeSymbol.get(anchor);
      const market = exchangeSymbol ? exchange.markets?.[exchangeSymbol] : null;
      const snapshot = normalizeSnapshot(anchor, exchange.id, item, market);
      if (snapshot) snapshotsByAnchor.set(anchor, snapshot);
    }

    // Keep one concise marker to help debug why this exchange may have low coverage.
    if (batchFailed && !records.length) {
      failures.push({
        symbol: "batch",
        reason: "batch returned zero records, entering single fetch fallback",
      });
    }
  }

  const missingAnchors = Array.from(anchorToExchangeSymbol.keys()).filter(
    (anchor) => !snapshotsByAnchor.has(anchor),
  );

  if (!missingAnchors.length || typeof exchange.fetchOpenInterest !== "function") {
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
    const market = exchangeSymbol ? exchange.markets?.[exchangeSymbol] : null;
    try {
      const row = await exchange.fetchOpenInterest(exchangeSymbol);
      const snapshot = normalizeSnapshot(anchor, exchange.id, row, market);
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

  // For amount-only rows, try to fetch ticker price so they can be converted to notional value.
  if (exchange.has?.fetchTicker) {
    const needsPriceAnchors = Array.from(snapshotsByAnchor.entries())
      .filter(([, row]) => row.metric === "amount" && row.price == null)
      .map(([anchor]) => anchor);

    for (const anchor of needsPriceAnchors) {
      const exchangeSymbol = anchorToExchangeSymbol.get(anchor);
      if (!exchangeSymbol) continue;
      try {
        const ticker = await exchange.fetchTicker(exchangeSymbol);
        const price = pickFirstNumber([
          ticker?.mark,
          ticker?.last,
          ticker?.close,
          ticker?.info?.markPrice,
          ticker?.info?.indexPrice,
          ticker?.info?.lastPrice,
          ticker?.info?.price,
        ]);
        if (price != null) {
          const row = snapshotsByAnchor.get(anchor);
          if (row) row.price = price;
        }
      } catch {
        // Ignore ticker fetch errors for conversion.
      }

      await sleep(Math.max(20, exchange.rateLimit || 50));
    }
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
            rows: [],
          });
        }

        const entry = aggregateMap.get(row.symbol);
        entry.ts = Math.max(entry.ts, row.ts);
        entry.rows.push({
          exchange: row.exchange,
          oi: row.oi,
          metric: row.metric,
          price: row.price ?? null,
        });
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
    const rows = entry.rows || [];
    if (!rows.length) continue;

    const hasAnyValueRow = rows.some((row) => row.metric === "value");
    const knownAmountPrices = rows
      .filter((row) => row.metric === "amount" && row.price != null)
      .map((row) => row.price);
    const proxyPrice = median(knownAmountPrices);

    const normalizedRows = rows.map((row) => {
      if (row.metric === "value") {
        return {
          ...row,
          value: row.oi,
          included: true,
          converted: false,
          estimated: false,
        };
      }

      if (row.metric === "amount" && row.price != null) {
        return {
          ...row,
          value: row.oi * row.price,
          included: true,
          converted: true,
          estimated: false,
        };
      }

      if (row.metric === "amount" && proxyPrice != null) {
        return {
          ...row,
          price: proxyPrice,
          value: row.oi * proxyPrice,
          included: true,
          converted: true,
          estimated: true,
        };
      }

      return {
        ...row,
        value: null,
        included: !hasAnyValueRow,
        converted: false,
        estimated: false,
      };
    });

    const includedRows = normalizedRows.filter((row) => row.included);
    if (!includedRows.length) continue;

    const useValueMetric = includedRows.some((row) => row.value != null);
    const oi = useValueMetric
      ? includedRows.reduce((sum, row) => sum + (row.value ?? 0), 0)
      : includedRows.reduce((sum, row) => sum + row.oi, 0);

    snapshots.push({
      symbol,
      oi,
      metric: useValueMetric ? "value" : "amount",
      ts: entry.ts || Date.now(),
      exchanges: normalizedRows,
    });
  }

  return {
    snapshots,
    failures,
    exchangeStats,
  };
}
