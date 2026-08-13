import { NextResponse } from "next/server";

import { fetchLargeDeals } from "@/lib/providers/nse";
import { cached } from "@/lib/twelvedata/cache";
import { findBySymbol } from "@/lib/market/universe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk and block deals from the latest Indian session.
 *
 * Published once per session, so an hour of caching costs nothing in freshness
 * and keeps the exchange's bot protection from being provoked.
 */
export async function GET() {
  try {
    const { value } = await cached(
      "large-deals",
      { ttl: 3_600_000, maxAge: 21_600_000 },
      fetchLargeDeals,
    );

    const deals = value.deals.map((d) => ({
      ...d,
      slug: findBySymbol(d.symbol)?.slug ?? null,
    }));

    // A rough read of the session: who was accumulating, who was distributing.
    const buyValue = deals
      .filter((d) => d.side === "BUY" && d.kind !== "short")
      .reduce((s, d) => s + (d.value ?? 0), 0);
    const sellValue = deals
      .filter((d) => d.side === "SELL" && d.kind !== "short")
      .reduce((s, d) => s + (d.value ?? 0), 0);

    return NextResponse.json(
      {
        data: deals,
        asOfLabel: value.asOf,
        summary: {
          buyValue,
          sellValue,
          netValue: buyValue - sellValue,
          bulk: deals.filter((d) => d.kind === "bulk").length,
          block: deals.filter((d) => d.kind === "block").length,
          short: deals.filter((d) => d.kind === "short").length,
        },
        asOf: Date.now(),
      },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        data: [],
        asOfLabel: "",
        summary: null,
        notice:
          err instanceof Error && err.message.includes("bot protection")
            ? "The exchange is rate-limiting automated requests right now. Try again shortly."
            : "Deal data is temporarily unavailable.",
        asOf: Date.now(),
      },
      { status: 200 },
    );
  }
}
