function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const CONFIG = {
  quoteAsset: process.env.QUOTE_ASSET || "USDT",
  symbolLimit: toInt(process.env.SYMBOL_LIMIT, 0),
  retentionHours: toInt(process.env.RETENTION_HOURS, 48),
  maxPointsPerSymbol: toInt(process.env.MAX_POINTS_PER_SYMBOL, 3000),
  exchangeTimeoutMs: toInt(process.env.EXCHANGE_TIMEOUT_MS, 20000),
  fallbackSingleFetchThreshold: toInt(process.env.FALLBACK_SINGLE_FETCH_THRESHOLD, 120),
  cronSecret: process.env.CRON_SECRET || "",
  collectToken: process.env.COLLECT_TOKEN || "",
  targetSymbols: parseCsv(process.env.TARGET_SYMBOLS),
  aggExchanges: parseCsv(
    process.env.AGG_EXCHANGES ||
      "binanceusdm,bybit,okx,bitget,gateio,kucoinfutures,mexc,bingx",
  ),
};

export function getRetentionMs() {
  return Math.max(1, CONFIG.retentionHours) * 60 * 60 * 1000;
}

export function isCronAuthorized(request) {
  if (!CONFIG.cronSecret) return true;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${CONFIG.cronSecret}`;
}

export function isManualCollectAuthorized(request) {
  if (!CONFIG.collectToken) return true;
  const auth = request.headers.get("x-collect-token");
  const token = new URL(request.url).searchParams.get("token");
  return auth === CONFIG.collectToken || token === CONFIG.collectToken;
}
