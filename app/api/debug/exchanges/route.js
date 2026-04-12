import { NextResponse } from "next/server";
import { readCollectStats } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["hkg1", "sin1", "hnd1"];

export async function GET() {
  try {
    const stats = await readCollectStats();

    if (!stats || !stats.at) {
      return NextResponse.json(
        {
          ok: false,
          error: "no collect stats yet, trigger /api/collect first",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      at: stats.at,
      symbols: stats.symbols ?? 0,
      collected: stats.collected ?? 0,
      exchanges: stats.exchanges ?? 0,
      failed: stats.failed ?? 0,
      exchangeStats: Array.isArray(stats.exchangeStats) ? stats.exchangeStats : [],
      failures: Array.isArray(stats.failures) ? stats.failures.slice(0, 80) : [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "failed to read exchange debug stats",
      },
      { status: 500 },
    );
  }
}
