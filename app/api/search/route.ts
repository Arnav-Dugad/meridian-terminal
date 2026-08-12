import { NextResponse, type NextRequest } from "next/server";

import { searchUniverse } from "@/lib/market/universe";

export const runtime = "nodejs";

/**
 * Symbol search runs entirely against the local universe.
 *
 * Twelve Data's /symbol_search would cost a credit per keystroke and return
 * thousands of venues for the same company. Ranking a 130-name in-memory list
 * is sub-millisecond, works offline, and lets the command palette respond on
 * every keystroke without debouncing against a paid API.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 48);
  const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 12));

  const results = searchUniverse(q, limit).map((i) => ({
    symbol: i.symbol,
    slug: i.slug,
    name: i.name,
    exchange: i.exchange,
    region: i.region,
    currency: i.currency,
    sector: i.sector,
    kind: i.kind,
  }));

  return NextResponse.json(
    { data: results, asOf: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
