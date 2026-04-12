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

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const lookbackHours = Math.max(1, Math.min(24, toInt(url.searchParams.get("lookbackHours"), 1)));
    const limit = Math.max(1, Math.min(2000, toInt(url.searchParams.get("limit"), 500)));
    const readLimit = Math.max(240, lookbackHours * 120 + 60);

    const symbols = await listSymbols();
    if (!symbols.length) {
      return NextResponse.json({
        ok: true,
        lookbackHours,
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
      const targetTs = latest.ts - lookbackHours * 60 * 60 * 1000;
      const baseline = pickBaseline(points, targetTs);
      if (!baseline) continue;

      const delta = latest.oi - baseline.oi;
      const pct = baseline.oi !== 0 ? (delta / baseline.oi) * 100 : null;
      const includedExchanges = (latest.exchanges || []).filter((row) => row?.included !== false).length;
      const totalExchanges = (latest.exchanges || []).length;

      rows.push({
        symbol,
        latestOi: latest.oi,
        baselineOi: baseline.oi,
        delta,
        pct,
        latestTs: latest.ts,
        baselineTs: baseline.ts,
        fullWindow: baseline.ts <= targetTs,
        includedExchanges,
        totalExchanges,
      });
    }

    rows.sort((a, b) => {
      if (a.fullWindow !== b.fullWindow) return a.fullWindow ? -1 : 1;
      return b.delta - a.delta;
    });

    return NextResponse.json({
      ok: true,
      lookbackHours,
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
