import { NextResponse, type NextRequest } from "next/server";

import { getNews } from "@/lib/twelvedata/service";
import { findBySlug } from "@/lib/market/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Market or company news.
 *
 * `?symbol=` scopes to one instrument; omitting it returns the general market
 * feed. Both are cached for ten minutes upstream — news is expensive relative
 * to how fast it changes, and a headline that is nine minutes old is still a
 * headline.
 */
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 20));

  if (symbol && !findBySlug(symbol)) {
    return NextResponse.json({ error: `Unknown instrument: ${symbol}` }, { status: 404 });
  }

  const { data, source, notice, providers } = await getNews(symbol, limit);

  return NextResponse.json(
    { data, source, notice, providers, asOf: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" } },
  );
}
