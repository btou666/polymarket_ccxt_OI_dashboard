function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const CONFIG = {
  quoteAsset: process.env.QUOTE_ASSET || "USDT",
  symbolLimit: toInt(process.env.SYMBOL_LIMIT, 80),
  retentionHours: toInt(process.env.RETENTION_HOURS, 48),
  maxPointsPerSymbol: toInt(process.env.MAX_POINTS_PER_SYMBOL, 3000),
  cronSecret: process.env.CRON_SECRET || "",
  collectToken: process.env.COLLECT_TOKEN || "",
  targetSymbols: (process.env.TARGET_SYMBOLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
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
