import { NextResponse } from "next/server";
import { listSymbols, readSeriesBatch } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(2000, toInt(url.searchParams.get("limit"), 500)));
    const windows = [1, 3, 6];
    const sortHours = windows.includes(toInt(url.searchParams.get("sortHours"), 6))
      ? toInt(url.searchParams.get("sortHours"), 6)
      : 6;
    const maxHours = Math.max(...windows);
    const readLimit = Math.max(360, maxHours * 120 + 120);

    const symbols = await listSymbols();
    if (!symbols.length) {
      return NextResponse.json({
        ok: true,
        sortHours,
        generatedAt: Date.now(),
        rows: [],
      });
    }

    const seriesMap = await readSeriesBatch(symbols, readLimit);
    const rows = [];

    for (const symbol of symbols) {
      const points = (seriesMap[symbol] || []).filter((p) => Number.isFinite(p?.ts) && Number.isFinite(p?.oi));
      if (points.length < 2) continue;

      points.sort((a, b) => a.ts - b.ts);
      const latest = points[points.length - 1];
      const h1 = calcWindow(points, latest, 1);
      const h3 = calcWindow(points, latest, 3);
      const h6 = calcWindow(points, latest, 6);
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
        latestTs: latest.ts,
        baselineTs1h: h1.baselineTs,
        baselineTs3h: h3.baselineTs,
        baselineTs6h: h6.baselineTs,
        fullWindow1h: h1.fullWindow,
        fullWindow3h: h3.fullWindow,
        fullWindow6h: h6.fullWindow,
        includedExchanges,
        totalExchanges,
      });
    }

    const fullWindowKey = `fullWindow${sortHours}h`;
    const pctKey = `pct${sortHours}h`;
    const deltaKey = `delta${sortHours}h`;

    rows.sort((a, b) => {
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

    return NextResponse.json({
      ok: true,
      sortHours,
      generatedAt: Date.now(),
      total: rows.length,
      rows: rows.slice(0, limit),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "failed to build rankings",
      },
      { status: 500 },
    );
  }
}
