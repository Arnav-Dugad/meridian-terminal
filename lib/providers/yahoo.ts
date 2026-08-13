import "server-only";

import { num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type { ProviderMeta, QuoteProvider } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";

/**
 * Yahoo Finance.
 *
 * The provider that makes Indian data actually work.
 *
 * Twelve Data's free tier returns a hard 404 for NSE and BSE — "available
 * starting with the Grow plan" — so on a free stack there was no route to an
 * Indian quote at all, and India fell through to simulation no matter how the
 * budget was spent. Yahoo's chart endpoint serves NSE and BSE equities, both
 * countries' indices, and crypto, with full OHLCV history, no key, and no
 * published per-minute cap.
 *
 * ── The honest caveat ──────────────────────────────────────────────────────
 * This is an undocumented endpoint. It is not contractual, it can rate-limit
 * datacentre IP ranges, and it can change without notice. That is precisely
 * why it sits inside the same failover chain as everything else rather than
 * being called directly: if it stops answering, the registry moves to the next
 * provider and the UI relabels the figures. It is used because the alternative
 * for Indian data is nothing at all.
 *
 * A browser-like User-Agent is sent because the endpoint returns 403 to an
 * unset or obviously automated one.
 */

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const ID = "yahoo";

// No published limit. This is a self-imposed ceiling that keeps a dashboard
// mount well clear of the throttling that datacentre ranges attract.
registerLimiter(ID, { perMinute: 60 });

export const yahooMeta: ProviderMeta = {
  id: ID,
  label: "Yahoo Finance",
  homepage: "https://finance.yahoo.com",
  capabilities: ["quote", "series"],
  coverage: ["IN", "US", "CRYPTO"],
  // No key required, so this is always available.
  configured: true,
  envVar: null,
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json",
};

/**
 * Yahoo's ticker namespace differs from every other provider's, so the mapping
 * is explicit rather than guessed:
 *
 *   NSE equity   RELIANCE   → RELIANCE.NS
 *   BSE equity   RELIANCE   → RELIANCE.BO
 *   US equity    AAPL       → AAPL       (but BRK.B → BRK-B: dots are
 *                                         separators, so classes use a hyphen)
 *   Indices                 → caret-prefixed, per the table below
 *   Crypto       BTC        → BTC-USD
 */
const INDEX_SYMBOLS: Record<string, string> = {
  NIFTY50: "^NSEI",
  NIFTYBANK: "^NSEBANK",
  SENSEX: "^BSESN",
  SPX: "^GSPC",
  IXIC: "^IXIC",
  DJI: "^DJI",
};

export function yahooSymbolFor(inst: Instrument): string | null {
  if (inst.kind === "index") return INDEX_SYMBOLS[inst.slug] ?? null;
  if (inst.kind === "crypto") return `${inst.symbol}-USD`;

  if (inst.exchange === "NSE") return `${inst.symbol}.NS`;
  if (inst.exchange === "BSE") return `${inst.symbol}.BO`;

  // US listings: share classes are hyphenated on Yahoo (BRK.B → BRK-B).
  return inst.symbol.replace(".", "-");
}

interface ChartMeta {
  currency?: string;
  symbol?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketTime?: number;
  longName?: string;
}

interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: {
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

interface ChartResponse {
  chart?: { result?: ChartResult[] | null; error?: { description?: string } | null };
}

function chartUrl(symbol: string, interval: string, range: string): string {
  // The symbol goes in the path, so `M&M.NS` and `^NSEI` must be encoded or
  // the query string is truncated at the ampersand.
  const u = new URL(`${BASE}/${encodeURIComponent(symbol)}`);
  u.searchParams.set("interval", interval);
  u.searchParams.set("range", range);
  return u.toString();
}

async function fetchChart(symbol: string, interval: string, range: string): Promise<ChartResult | null> {
  const payload = await providerFetch<ChartResponse>(chartUrl(symbol, interval, range), {
    provider: ID,
    cost: 1,
    maxWaitMs: 900,
    headers: HEADERS,
  });
  return payload.chart?.result?.[0] ?? null;
}

export const yahoo: QuoteProvider = {
  meta: yahooMeta,

  /**
   * One request per symbol — Yahoo's batch quote endpoint now requires a
   * crumb/cookie handshake, whereas the chart endpoint stays open. Requests go
   * out with a concurrency cap so a forty-row table does not open forty
   * sockets at once.
   */
  async fetchQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const CONCURRENCY = 6;
    const out: Quote[] = [];
    const queue = instruments
      .map((inst) => ({ inst, symbol: yahooSymbolFor(inst) }))
      .filter((x): x is { inst: Instrument; symbol: string } => Boolean(x.symbol));

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          const result = await fetchChart(job.symbol, "1d", "1d");
          const quote = result ? normalise(result, job.inst) : null;
          if (quote) out.push(quote);
        } catch {
          // A single symbol failing must not sink the batch.
        }
      }
    });

    await Promise.all(workers);
    return out;
  },

  async fetchSeries(inst: Instrument, range: RangeKey): Promise<Candle[]> {
    const symbol = yahooSymbolFor(inst);
    if (!symbol) return [];

    const spec = YAHOO_RANGE[range];
    const result = await fetchChart(symbol, spec.interval, spec.range);
    if (!result?.timestamp || result.timestamp.length === 0) return [];

    const q = result.indicators?.quote?.[0];
    if (!q?.close) return [];

    const candles: Candle[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const close = q.close[i];
      const t = result.timestamp[i];
      // Yahoo pads holidays and halts with nulls; skipping them is correct,
      // interpolating would invent bars that never traded.
      if (t == null || close == null) continue;

      const open = q.open?.[i] ?? close;
      const high = q.high?.[i] ?? Math.max(open, close);
      const low = q.low?.[i] ?? Math.min(open, close);

      candles.push({
        t: t * 1000,
        o: open,
        h: high,
        l: low,
        c: close,
        v: q.volume?.[i] ?? 0,
      });
    }

    candles.sort((a, b) => a.t - b.t);
    return candles;
  },
};

function normalise(result: ChartResult, inst: Instrument): Quote | null {
  const meta = result.meta;
  if (!meta) return null;

  const price = num(meta.regularMarketPrice);
  if (price == null) return null;

  const previousClose = num(meta.chartPreviousClose) ?? num(meta.previousClose) ?? price;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  const high52 = num(meta.fiftyTwoWeekHigh);
  const low52 = num(meta.fiftyTwoWeekLow);

  // The intraday open is not on the meta object, so it is taken from the first
  // bar of the day's series when present.
  const opens = result.indicators?.quote?.[0]?.open;
  const open = opens?.find((v): v is number => v != null) ?? previousClose;

  return {
    symbol: inst.symbol,
    slug: inst.slug,
    name: str(meta.longName) ?? inst.name,
    exchange: inst.exchange,
    region: inst.region,
    currency: inst.currency,
    sector: inst.sector,
    price,
    previousClose,
    open,
    dayHigh: num(meta.regularMarketDayHigh) ?? Math.max(open, price),
    dayLow: num(meta.regularMarketDayLow) ?? Math.min(open, price),
    change,
    changePercent,
    volume: num(meta.regularMarketVolume) ?? 0,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    fiftyTwoWeekPosition:
      high52 != null && low52 != null && high52 > low52 ? (price - low52) / (high52 - low52) : null,
    // Yahoo's chart meta carries no market cap; the registry backfills it from
    // whichever provider in the chain does.
    marketCap: null,
    timestamp: (num(meta.regularMarketTime) ?? Math.floor(Date.now() / 1000)) * 1000,
    isOpen: inst.kind === "crypto",
    source: "live",
    provider: ID,
  };
}

/**
 * Exchange rates.
 *
 * Yahoo quotes currency pairs as `USDINR=X` on the same chart endpoint used
 * for equities, which means the portfolio's conversion rate needs no key and
 * no separate budget. This is the primary FX source; Twelve Data is the
 * fallback where a key exists.
 */
export async function fetchFxRate(pair: string): Promise<number | null> {
  const symbol = `${pair.replace("/", "").toUpperCase()}=X`;
  try {
    const result = await fetchChart(symbol, "1d", "1d");
    return num(result?.meta?.regularMarketPrice);
  } catch {
    return null;
  }
}

/**
 * Yahoo takes an interval and a lookback rather than a bar count, and rejects
 * combinations it will not serve (intraday beyond 60 days, for instance).
 */
const YAHOO_RANGE: Record<RangeKey, { interval: string; range: string }> = {
  "1D": { interval: "5m", range: "1d" },
  "1W": { interval: "30m", range: "5d" },
  "1M": { interval: "1h", range: "1mo" },
  "6M": { interval: "1d", range: "6mo" },
  "1Y": { interval: "1d", range: "1y" },
  "5Y": { interval: "1wk", range: "5y" },
  MAX: { interval: "1mo", range: "max" },
};

export { ID as YAHOO_ID };
