import "server-only";

import { isoMs, num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type { ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";

/**
 * CoinGecko.
 *
 * Adds crypto as a third asset class alongside the two equity markets. It is
 * the most generous free tier in the stack — no key required at all, and a
 * demo key raises the ceiling — and crucially it *batches*: `/coins/markets`
 * returns full quotes for fifty coins in one call, where Finnhub would need
 * fifty.
 *
 * Crypto is also the only market on this terminal that never closes, which is
 * why the session logic treats it as permanently open and the tape keeps
 * moving on a Sunday when both equity markets are dark.
 */

const BASE = "https://api.coingecko.com/api/v3";
const ID = "coingecko";

/**
 * Without a key CoinGecko throttles on shared IP reputation, and the effective
 * ceiling on a busy host is well below the published figure — a demo key
 * raises it to roughly 100/min. Budget accordingly rather than optimistically:
 * being refused by our own limiter is recoverable, being refused upstream
 * burns a round trip and poisons the window.
 */
registerLimiter(ID, { perMinute: demoKeyPresent() ? 80 : 12 });

function demoKeyPresent(): boolean {
  return Boolean(process.env.COINGECKO_API_KEY?.trim());
}

function demoKey(): string | null {
  return process.env.COINGECKO_API_KEY?.trim() || null;
}

export const coingeckoMeta: ProviderMeta = {
  id: ID,
  label: "CoinGecko",
  homepage: "https://www.coingecko.com",
  capabilities: ["quote", "series"],
  coverage: ["CRYPTO"],
  // Usable with no key at all, which is why this is always configured.
  configured: true,
  envVar: "COINGECKO_API_KEY",
};

function headers(): Record<string, string> {
  const k = demoKey();
  return k ? { "x-cg-demo-api-key": k } : {};
}

interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  high_24h: number | null;
  low_24h: number | null;
  price_change_24h: number | null;
  price_change_percentage_24h: number | null;
  ath: number | null;
  atl: number | null;
  last_updated: string | null;
}

export const coingecko: QuoteProvider = {
  meta: coingeckoMeta,

  /**
   * One call for the whole set. `coinId` is carried on the instrument because
   * CoinGecko keys on its own slug ("bitcoin"), not the ticker — and tickers
   * collide across chains in a way that ids do not.
   */
  async fetchQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const ids = instruments.map((i) => i.coinId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    const url = new URL(`${BASE}/coins/markets`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("order", "market_cap_desc");
    url.searchParams.set("per_page", String(Math.min(250, ids.length)));
    url.searchParams.set("page", "1");
    url.searchParams.set("sparkline", "false");
    url.searchParams.set("price_change_percentage", "24h");

    const rows = await providerFetch<MarketRow[]>(url.toString(), {
      provider: ID,
      cost: 1,
      maxWaitMs: 1200,
      headers: headers(),
    });
    if (!Array.isArray(rows)) return [];

    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: Quote[] = [];

    for (const inst of instruments) {
      const row = inst.coinId ? byId.get(inst.coinId) : undefined;
      const price = num(row?.current_price);
      if (!row || price == null) continue;

      const change = num(row.price_change_24h) ?? 0;
      const previousClose = price - change;
      const high = num(row.high_24h) ?? price;
      const low = num(row.low_24h) ?? price;
      const ath = num(row.ath);
      const atl = num(row.atl);

      out.push({
        symbol: inst.symbol,
        slug: inst.slug,
        name: inst.name,
        exchange: inst.exchange,
        region: inst.region,
        currency: inst.currency,
        sector: inst.sector,
        price,
        previousClose,
        // Crypto has no session open; the 24-hour-ago price is the honest
        // analogue and is what every crypto venue displays.
        open: previousClose,
        dayHigh: high,
        dayLow: low,
        change,
        changePercent: num(row.price_change_percentage_24h) ?? 0,
        volume: num(row.total_volume) ?? 0,
        // All-time high/low stand in for the 52-week band. For an asset class
        // where drawdowns from ATH are the headline statistic, this is the
        // more meaningful reference anyway.
        fiftyTwoWeekHigh: ath,
        fiftyTwoWeekLow: atl,
        fiftyTwoWeekPosition:
          ath != null && atl != null && ath > atl ? (price - atl) / (ath - atl) : null,
        marketCap: num(row.market_cap),
        timestamp: isoMs(row.last_updated) ?? Date.now(),
        isOpen: true,
        source: "live",
        provider: ID,
      });
    }

    return out;
  },

  /**
   * `/market_chart` returns [timestamp, price] pairs at a granularity CoinGecko
   * chooses from the day count, so bars are synthesised by bucketing rather
   * than requested directly. Volume comes back on its own axis and is joined
   * by nearest timestamp.
   */
  async fetchSeries(inst: Instrument, range: RangeKey): Promise<Candle[]> {
    if (!inst.coinId) return [];

    const days = DAYS_FOR_RANGE[range];
    const url = new URL(`${BASE}/coins/${inst.coinId}/market_chart`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("days", String(days));
    // Hourly below 90 days, daily above — CoinGecko's own rule; asking for a
    // granularity it will not serve returns an error rather than a fallback.
    if (days > 90) url.searchParams.set("interval", "daily");

    const raw = await providerFetch<{
      prices?: [number, number][];
      total_volumes?: [number, number][];
    }>(url.toString(), { provider: ID, cost: 1, maxWaitMs: 1200, headers: headers() });

    const prices = raw.prices ?? [];
    if (prices.length === 0) return [];

    const volumes = new Map((raw.total_volumes ?? []).map(([t, v]) => [t, v]));
    const target = RANGE_SPEC[range].outputsize;
    const bucketSize = Math.max(1, Math.ceil(prices.length / target));

    const candles: Candle[] = [];
    for (let i = 0; i < prices.length; i += bucketSize) {
      const bucket = prices.slice(i, i + bucketSize);
      if (bucket.length === 0) continue;

      const open = bucket[0]![1];
      const close = bucket[bucket.length - 1]![1];
      let high = -Infinity;
      let low = Infinity;
      let volume = 0;
      for (const [t, p] of bucket) {
        if (p > high) high = p;
        if (p < low) low = p;
        volume += volumes.get(t) ?? 0;
      }

      candles.push({
        t: bucket[bucket.length - 1]![0],
        o: open,
        h: high,
        l: low,
        c: close,
        // Volume is a running total per sample, so the bucket mean is a better
        // estimate of the interval's turnover than the sum.
        v: bucket.length > 0 ? volume / bucket.length : 0,
      });
    }

    return candles;
  },
};

const DAYS_FOR_RANGE: Record<RangeKey, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "6M": 180,
  "1Y": 365,
  "5Y": 1825,
  MAX: 3650,
};

export { ID as COINGECKO_ID };

/** Exposed for the search route so unknown coins can still resolve. */
export async function searchCoins(query: string): Promise<{ id: string; symbol: string; name: string }[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("query", query);
  try {
    const raw = await providerFetch<{ coins?: unknown[] }>(url.toString(), {
      provider: ID,
      maxWaitMs: 600,
      headers: headers(),
    });
    return (raw.coins ?? [])
      .map((c) => {
        const r = c as Record<string, unknown>;
        const id = str(r["id"]);
        const symbol = str(r["symbol"]);
        const name = str(r["name"]);
        return id && symbol && name ? { id, symbol: symbol.toUpperCase(), name } : null;
      })
      .filter((c): c is { id: string; symbol: string; name: string } => c !== null)
      .slice(0, 8);
  } catch {
    return [];
  }
}
