import { NextResponse } from "next/server";
import { listSymbols, readSeriesBatch } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const WINDOWS = [1, 3, 6, 12];
const MAX_WINDOW_HOURS = Math.max(...WINDOWS);
const RANKINGS_CACHE_TTL_MS = Math.max(3_000, toInt(process.env.RANKINGS_CACHE_TTL_MS, 45_000));

let rankingsCache = {
  ts: 0,
  generatedAt: 0,
  rows: [],
};
let refreshPromise = null;

function pickBaseline(points, targetTs) {
  let baseline = null;
  for (const point of points) {
    if (point.ts <= targetTs) {
      baseline = point;
    } else {
      break;
    }
  }
  return baseline || points[0] || null;
}

function calcWindow(points, latest, hours) {
  const targetTs = latest.ts - hours * 60 * 60 * 1000;
  const baseline = pickBaseline(points, targetTs);
  if (!baseline) {
    return {
      delta: null,
      pct: null,
      baselineTs: null,
      fullWindow: false,
    };
  }

  const delta = latest.oi - baseline.oi;
  const pct = baseline.oi !== 0 ? (delta / baseline.oi) * 100 : null;
  return {
    delta,
    pct,
    baselineTs: baseline.ts,
    fullWindow: baseline.ts <= targetTs,
  };
}

function getReadLimit() {
  const collectIntervalMs = Math.max(15_000, toInt(process.env.COLLECT_INTERVAL_MS, 60_000));
  const pointsPerHour = Math.max(12, Math.min(240, Math.ceil(3_600_000 / collectIntervalMs)));
  return Math.max(240, Math.min(2_000, MAX_WINDOW_HOURS * pointsPerHour + pointsPerHour * 2));
}

function sortRows(rows, sortHours) {
  const fullWindowKey = `fullWindow${sortHours}h`;
  const pctKey = `pct${sortHours}h`;
  const deltaKey = `delta${sortHours}h`;
  const sorted = [...rows];

  sorted.sort((a, b) => {
    const fullA = a[fullWindowKey];
    const fullB = b[fullWindowKey];
    if (fullA !== fullB) return fullA ? -1 : 1;

    const pctA = Number.isFinite(a[pctKey]) ? a[pctKey] : -Infinity;
    const pctB = Number.isFinite(b[pctKey]) ? b[pctKey] : -Infinity;
    if (pctA !== pctB) return pctB - pctA;

    const deltaA = Number.isFinite(a[deltaKey]) ? a[deltaKey] : -Infinity;
    const deltaB = Number.isFinite(b[deltaKey]) ? b[deltaKey] : -Infinity;
    return deltaB - deltaA;
  });

  return sorted;
}

async function buildRankingsRows() {
  const symbols = await listSymbols();
  if (!symbols.length) {
    return {
      generatedAt: Date.now(),
      rows: [],
    };
  }

  const seriesMap = await readSeriesBatch(symbols, getReadLimit());
  const rows = [];

  for (const symbol of symbols) {
    const points = (seriesMap[symbol] || []).filter((p) => Number.isFinite(p?.ts) && Number.isFinite(p?.oi));
    if (points.length < 2) continue;

    points.sort((a, b) => a.ts - b.ts);
    const latest = points[points.length - 1];
    const h1 = calcWindow(points, latest, 1);
    const h3 = calcWindow(points, latest, 3);
    const h6 = calcWindow(points, latest, 6);
    const h12 = calcWindow(points, latest, 12);
    const includedExchanges = (latest.exchanges || []).filter((row) => row?.included !== false).length;
    const totalExchanges = (latest.exchanges || []).length;

    rows.push({
      symbol,
      latestOi: latest.oi,
      delta1h: h1.delta,
      pct1h: h1.pct,
      delta3h: h3.delta,
      pct3h: h3.pct,
      delta6h: h6.delta,
      pct6h: h6.pct,
      delta12h: h12.delta,
      pct12h: h12.pct,
      latestTs: latest.ts,
      baselineTs1h: h1.baselineTs,
      baselineTs3h: h3.baselineTs,
      baselineTs6h: h6.baselineTs,
      baselineTs12h: h12.baselineTs,
      fullWindow1h: h1.fullWindow,
      fullWindow3h: h3.fullWindow,
      fullWindow6h: h6.fullWindow,
      fullWindow12h: h12.fullWindow,
      includedExchanges,
      totalExchanges,
    });
  }

  return {
    generatedAt: Date.now(),
    rows,
  };
}

async function refreshCache() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const payload = await buildRankingsRows();
    rankingsCache = {
      ts: Date.now(),
      generatedAt: payload.generatedAt,
      rows: payload.rows,
    };
    return rankingsCache;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function cacheAgeMs() {
  if (!rankingsCache.ts) return Number.POSITIVE_INFINITY;
  return Date.now() - rankingsCache.ts;
}

async function getSnapshotWithRefresh() {
  if (!rankingsCache.ts) {
    return refreshCache();
  }

  if (cacheAgeMs() > RANKINGS_CACHE_TTL_MS && !refreshPromise) {
    // Refresh in background and return stale cache immediately for fast response.
    refreshCache().catch(() => {});
  }

  return rankingsCache;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(2000, toInt(url.searchParams.get("limit"), 500)));
    const sortHours = WINDOWS.includes(toInt(url.searchParams.get("sortHours"), 6))
      ? toInt(url.searchParams.get("sortHours"), 6)
      : 6;

    let snapshot;
    try {
      snapshot = await getSnapshotWithRefresh();
    } catch (cacheErr) {
      if (rankingsCache.ts) {
        snapshot = rankingsCache;
      } else {
        throw cacheErr;
      }
    }

    const sortedRows = sortRows(snapshot.rows || [], sortHours);
    const ageMs = cacheAgeMs();

    return NextResponse.json({
      ok: true,
      sortHours,
      generatedAt: snapshot.generatedAt || Date.now(),
      total: sortedRows.length,
      rows: sortedRows.slice(0, limit),
      stale: ageMs > RANKINGS_CACHE_TTL_MS,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      cacheTtlMs: RANKINGS_CACHE_TTL_MS,
      refreshing: Boolean(refreshPromise),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err?.message || "failed to build rankings",
    }, { status: 500 });
  }
}
