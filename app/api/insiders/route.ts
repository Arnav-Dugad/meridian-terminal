import { NextResponse, type NextRequest } from "next/server";

import { finnhub, fetchIpoCalendar, type InsiderTrade } from "@/lib/providers/finnhub";
import { cached } from "@/lib/twelvedata/cache";
import { findBySlug } from "@/lib/market/universe";
import { canAttempt } from "@/lib/providers/breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Insider transactions, and the IPO calendar.
 *
 * Both come from the same provider, so they share a route — `?symbol=` returns
 * insider filings for one company, and omitting it returns the listings
 * calendar.
 *
 * Nothing is fabricated on failure: an unreachable source returns an empty
 * list and a reason, which the interface renders as an explicit gap.
 */

interface InsiderSummary {
  netShares: number;
  buyCount: number;
  sellCount: number;
  openMarketBuyValue: number;
  openMarketSellValue: number;
  /** Plain-language read of recent activity. */
  interpretation: string;
}

function summarise(trades: InsiderTrade[]): InsiderSummary {
  const open = trades.filter((t) => t.openMarket);
  const buys = open.filter((t) => t.direction === "buy");
  const sells = open.filter((t) => t.direction === "sell");

  const buyValue = buys.reduce((s, t) => s + (t.value ?? 0), 0);
  const sellValue = sells.reduce((s, t) => s + (t.value ?? 0), 0);
  const netShares = buys.reduce((s, t) => s + t.shares, 0) - sells.reduce((s, t) => s + t.shares, 0);

  return {
    netShares,
    buyCount: buys.length,
    sellCount: sells.length,
    openMarketBuyValue: buyValue,
    openMarketSellValue: sellValue,
    interpretation: interpret(buys.length, sells.length, buyValue, sellValue, trades.length),
  };
}

/**
 * Insider selling is close to meaningless on its own — options vest, and
 * executives diversify on schedules set months ahead. Buying is the rarer and
 * more informative signal, which the wording reflects.
 */
function interpret(
  buys: number,
  sells: number,
  buyValue: number,
  sellValue: number,
  total: number,
): string {
  if (total === 0) return "No insider filings in the period covered.";
  if (buys === 0 && sells === 0) {
    return "Recent filings are all grants, gifts or option exercises — no open-market trades, which carry no directional signal.";
  }
  if (buys > 0 && sells === 0) {
    return `${buys} open-market purchase${buys === 1 ? "" : "s"} and no sales. Insider buying is the rarer and more informative of the two.`;
  }
  if (sells > 0 && buys === 0) {
    return `${sells} open-market sale${sells === 1 ? "" : "s"} and no purchases. Selling is weak evidence on its own — options vest and executives diversify on pre-set schedules.`;
  }
  return buyValue > sellValue
    ? `Insiders bought more than they sold on the open market across ${buys + sells} trades.`
    : `Insiders sold more than they bought across ${buys + sells} trades, which is the ordinary pattern for a company that pays in equity.`;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");

  if (!finnhub.meta.configured) {
    return NextResponse.json(
      { data: [], notice: "No source is configured for this data.", asOf: Date.now() },
      { status: 200 },
    );
  }
  if (!canAttempt(finnhub.meta.id)) {
    return NextResponse.json(
      {
        data: [],
        notice: "The data source is temporarily unavailable and is being retried automatically.",
        asOf: Date.now(),
      },
      { status: 200 },
    );
  }

  /* ── IPO calendar ─────────────────────────────────────────────────────── */
  if (!symbol) {
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

    try {
      const { value } = await cached("ipo-calendar", { ttl: 3_600_000, maxAge: 21_600_000 }, () =>
        fetchIpoCalendar(from, to),
      );
      return NextResponse.json(
        { data: value, kind: "ipo", from, to, asOf: Date.now() },
        { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" } },
      );
    } catch {
      return NextResponse.json(
        { data: [], kind: "ipo", notice: "The listings calendar is temporarily unavailable.", asOf: Date.now() },
        { status: 200 },
      );
    }
  }

  /* ── Insider filings ──────────────────────────────────────────────────── */
  const inst = findBySlug(symbol);
  if (!inst) return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });

  if (inst.region !== "US") {
    return NextResponse.json(
      {
        data: [],
        kind: "insider",
        notice:
          "Insider filings are published for US listings by the SEC. Indian disclosures are not available from the sources in use.",
        asOf: Date.now(),
      },
      { status: 200 },
    );
  }

  try {
    const { value } = await cached(
      `insiders:${inst.slug}`,
      { ttl: 21_600_000, maxAge: 86_400_000 },
      async () => {
        const trades = (await finnhub.fetchInsiderTransactions?.(inst)) ?? [];
        if (trades.length === 0) throw new Error("no filings");
        return trades;
      },
    );

    return NextResponse.json(
      { data: value, kind: "insider", summary: summarise(value), asOf: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json(
      { data: [], kind: "insider", notice: "No insider filings found for this company.", asOf: Date.now() },
      { status: 200 },
    );
  }
}
