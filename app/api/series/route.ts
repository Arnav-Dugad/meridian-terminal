import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSeries } from "@/lib/twelvedata/service";
import { RANGE_KEYS, type ApiEnvelope, type Series } from "@/lib/twelvedata/types";
import { findBySlug } from "@/lib/market/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().min(1).max(24),
  range: z.enum(RANGE_KEYS as [string, ...string[]]).default("1M"),
});

export async function GET(req: NextRequest) {
  const parsed = Query.safeParse({
    symbol: req.nextUrl.searchParams.get("symbol") ?? "",
    range: req.nextUrl.searchParams.get("range") ?? "1M",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid symbol or range" }, { status: 400 });
  }

  if (!findBySlug(parsed.data.symbol)) {
    return NextResponse.json({ error: `Unknown instrument: ${parsed.data.symbol}` }, { status: 404 });
  }

  try {
    const { data, source, notice } = await getSeries(
      parsed.data.symbol,
      parsed.data.range as Series["range"],
    );
    const body: ApiEnvelope<Series> = { data, source, asOf: Date.now(), notice };

    const intraday = data.interval.includes("min") || data.interval === "1h";
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": intraday
          ? "public, s-maxage=45, stale-while-revalidate=180"
          : "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
