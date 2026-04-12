import { NextResponse } from "next/server";
import { collectOpenInterest } from "@/lib/collector";
import { isCronAuthorized } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["hkg1", "sin1", "hnd1"];

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "cron unauthorized" }, { status: 401 });
  }

  try {
    const result = await collectOpenInterest();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "cron collect failed" },
      { status: 500 },
    );
  }
}
