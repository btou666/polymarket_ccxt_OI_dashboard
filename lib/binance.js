import ccxt from "ccxt";

const SYMBOL_CACHE_TTL = 10 * 60 * 1000;

let cached = {
  ts: 0,
  symbols: [],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOI(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRecord(symbol, raw) {
  const oi =
    parseOI(raw?.openInterestAmount) ??
    parseOI(raw?.openInterestValue) ??
    parseOI(raw?.openInterest) ??
    parseOI(raw?.amount) ??
    parseOI(raw?.value) ??
    null;

  if (oi == null) return null;

  return {
    symbol,
    oi,
    ts: Number(raw?.timestamp) || Date.now(),
  };
}

export function createBinanceClient() {
  return new ccxt.binanceusdm({
    enableRateLimit: true,
    options: {
      defaultType: "future",
    },
  });
}

export async function resolveSymbols(exchange, { quoteAsset, symbolLimit, requestedSymbols = [] }) {
  await exchange.loadMarkets();

  if (requestedSymbols.length) {
    return requestedSymbols.filter((symbol) => Boolean(exchange.markets?.[symbol]));
  }

  if (cached.symbols.length && Date.now() - cached.ts < SYMBOL_CACHE_TTL) {
    return cached.symbols.slice(0, symbolLimit);
  }

  const markets = exchange.markets || {};
  const symbols = Object.values(markets)
    .filter((market) => market?.swap && market?.linear && market?.quote === quoteAsset && market?.active)
    .map((market) => market.symbol)
    .sort((a, b) => a.localeCompare(b));

  cached = { ts: Date.now(), symbols };
  return symbols.slice(0, symbolLimit);
}

function normalizeBatchPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object") return Object.values(payload);
  return [];
}

export async function fetchOpenInterestSnapshots(exchange, symbols) {
  const snapshotsBySymbol = new Map();
  const failures = [];

  if (!symbols.length) {
    return { snapshots: [], failures: [] };
  }

  if (exchange.has?.fetchOpenInterests) {
    try {
      const payload = await exchange.fetchOpenInterests(symbols);
      const records = normalizeBatchPayload(payload);
      for (const item of records) {
        const symbol = item?.symbol;
        if (!symbol) continue;
        const normalized = normalizeRecord(symbol, item);
        if (normalized) snapshotsBySymbol.set(symbol, normalized);
      }
    } catch (err) {
      failures.push({ symbol: "batch", reason: err.message || String(err) });
    }
  }

  const missing = symbols.filter((symbol) => !snapshotsBySymbol.has(symbol));

  for (const symbol of missing) {
    try {
      const row = await exchange.fetchOpenInterest(symbol);
      const normalized = normalizeRecord(symbol, row);
      if (normalized) {
        snapshotsBySymbol.set(symbol, normalized);
      } else {
        failures.push({ symbol, reason: "empty open interest" });
      }
    } catch (err) {
      failures.push({ symbol, reason: err.message || String(err) });
    }

    await sleep(Math.max(30, exchange.rateLimit || 50));
  }

  return {
    snapshots: Array.from(snapshotsBySymbol.values()),
    failures,
  };
}
