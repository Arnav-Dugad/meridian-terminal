import { NextResponse, type NextRequest } from "next/server";

import { fetchCorporateActions } from "@/lib/providers/nse";
import { cached } from "@/lib/twelvedata/cache";
import { findBySymbol } from "@/lib/market/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upcoming dividends, splits, bonuses and buybacks on the Indian market.
 *
 * The exchange publishes the whole board at once, so this is fetched in full,
 * cached for an hour, and filtered per request. Symbols in the local universe
 * are linked; the rest are still listed, because a dividend on a name we do
 * not track is still a dividend.
 */
export async function GET(req: NextRequest) {
  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  const kind = req.nextUrl.searchParams.get("kind");

  try {
    const { value } = await cached(
      "corporate-actions",
      { ttl: 3_600_000, maxAge: 21_600_000 },
      fetchCorporateActions,
    );

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const filtered = value
      .filter((a) => a.exDate >= today && a.exDate <= horizon)
      .filter((a) => (kind && kind !== "all" ? a.kind === kind : true))
      // Meetings are announcements, not entitlements, and they swamp the list.
      .filter((a) => a.kind !== "meeting")
      .map((a) => ({ ...a, slug: findBySymbol(a.symbol)?.slug ?? null }));

    return NextResponse.json(
      { data: filtered, total: value.length, asOf: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        data: [],
        total: 0,
        notice:
          err instanceof Error && err.message.includes("bot protection")
            ? "The exchange is rate-limiting automated requests right now. Try again shortly."
            : "Corporate actions are temporarily unavailable.",
        asOf: Date.now(),
      },
      { status: 200 },
    );
  }
}
