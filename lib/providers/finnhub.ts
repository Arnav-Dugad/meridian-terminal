import "server-only";

import { epochMs, num, providerFetch, str } from "@/lib/providers/http";
import { registerLimiter } from "@/lib/providers/limiter";
import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
  NewsItem,
  ProviderMeta,
  QuoteProvider,
} from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";

/**
 * Finnhub.
 *
 * Sixty calls a minute on the free tier — nearly eight times Twelve Data's
 * budget — which makes it the right primary for US quotes and the only
 * practical source for the things a terminal needs many of: news, analyst
 * consensus, earnings surprises, peers.
 *
 * Two limitations shape how it is wired up:
 *
 *  - No batch quote endpoint. One symbol, one call. That is affordable at 60/min
 *    for a dashboard, and the registry parallelises with a concurrency cap.
 *  - Free-tier `/stock/candle` is restricted, so history stays with Twelve Data.
 *    Finnhub covers the *breadth* endpoints; Twelve Data covers depth.
 *
 * Indian listings are not covered on the free tier, so this provider declares
 * US-only coverage and the registry never routes NSE symbols here.
 */

const BASE = "https://finnhub.io/api/v1";
const ID = "finnhub";

registerLimiter(ID, { perMinute: 55 }); // 60 published; leave headroom for bursts.

function key(): string | null {
  return process.env.FINNHUB_API_KEY?.trim() || null;
}

export const finnhubMeta: ProviderMeta = {
  id: ID,
  label: "Finnhub",
  homepage: "https://finnhub.io",
  capabilities: ["quote", "profile", "news", "fundamentals", "recommendations", "earnings", "peers"],
  coverage: ["US"],
  get configured() {
    return key() !== null;
  },
  envVar: "FINNHUB_API_KEY",
};

function url(path: string, params: Record<string, string | number> = {}): string {
  const k = key();
  if (!k) throw new ProviderError(ID, "FINNHUB_API_KEY not configured", 401, true);
  const u = new URL(`${BASE}${path}`);
  for (const [name, value] of Object.entries(params)) u.searchParams.set(name, String(value));
  u.searchParams.set("token", k);
  return u.toString();
}

/** Finnhub's quote shape: c/d/dp/h/l/o/pc/t, all numbers, 0 when unknown. */
interface FinnhubQuote {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

interface FinnhubProfile {
  marketCapitalization?: number;
  shareOutstanding?: number;
  name?: string;
  finnhubIndustry?: string;
  weburl?: string;
  country?: string;
  logo?: string;
}

async function fetchOneQuote(inst: Instrument): Promise<Quote | null> {
  const raw = await providerFetch<FinnhubQuote>(url("/quote", { symbol: inst.symbol }), {
    provider: ID,
    cost: 1,
    maxWaitMs: 900,
  });

  // Finnhub answers 200 with all-zero fields for an unknown symbol rather than
  // a 404, so a zero close is the only reliable "no data" signal.
  const price = num(raw.c);
  if (price == null || price === 0) return null;

  const previousClose = num(raw.pc) ?? price;
  const change = num(raw.d) ?? price - previousClose;
  const changePercent =
    num(raw.dp) ?? (previousClose > 0 ? (change / previousClose) * 100 : 0);

  return {
    symbol: inst.symbol,
    slug: inst.slug,
    name: inst.name,
    exchange: inst.exchange,
    region: inst.region,
    currency: inst.currency,
    sector: inst.sector,
    price,
    previousClose,
    open: num(raw.o) || price,
    dayHigh: num(raw.h) || price,
    dayLow: num(raw.l) || price,
    change,
    changePercent,
    // Finnhub's quote carries no volume; the registry backfills it where a
    // second provider has it, and the UI renders an em dash otherwise.
    volume: 0,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekPosition: null,
    marketCap: null,
    timestamp: epochMs(raw.t) ?? Date.now(),
    isOpen: false,
    source: "live",
    provider: ID,
  };
}

export const finnhub: QuoteProvider = {
  meta: finnhubMeta,

  /**
   * No batch endpoint, so symbols go out in parallel with a concurrency cap.
   * Unbounded `Promise.all` over forty symbols would burn most of a minute's
   * budget in one tick and starve everything else on the page.
   */
  async fetchQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const CONCURRENCY = 8;
    const out: Quote[] = [];
    const queue = [...instruments];

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const inst = queue.shift();
        if (!inst) return;
        try {
          const quote = await fetchOneQuote(inst);
          if (quote) out.push(quote);
        } catch (err) {
          // A single symbol failing must not sink the batch. Budget
          // exhaustion, though, means every remaining symbol will fail too —
          // stop immediately rather than grinding through forty rejections.
          if (err instanceof ProviderError && err.status === 429) {
            queue.length = 0;
            return;
          }
        }
      }
    });

    await Promise.all(workers);
    return out;
  },

  async fetchProfileExtras(inst: Instrument): Promise<Partial<Fundamentals> | null> {
    const raw = await providerFetch<FinnhubProfile>(
      url("/stock/profile2", { symbol: inst.symbol }),
      { provider: ID, maxWaitMs: 600 },
    );
    const capMillions = num(raw.marketCapitalization);
    return {
      // Finnhub reports market cap in millions of the listing currency.
      marketCap: capMillions != null ? capMillions * 1e6 : null,
      sharesOutstanding: num(raw.shareOutstanding) != null ? num(raw.shareOutstanding)! * 1e6 : null,
    };
  },

  async fetchNews(inst: Instrument | null, limit: number): Promise<NewsItem[]> {
    const path = inst ? "/company-news" : "/news";
    const params: Record<string, string | number> = inst
      ? {
          symbol: inst.symbol,
          // Company news requires an explicit window; a fortnight is enough to
          // fill a panel without pulling a year of noise.
          from: isoDay(Date.now() - 14 * 86_400_000),
          to: isoDay(Date.now()),
        }
      : { category: "general" };

    const raw = await providerFetch<unknown[]>(url(path, params), {
      provider: ID,
      maxWaitMs: 900,
    });
    if (!Array.isArray(raw)) return [];

    return raw
      .map((row) => normaliseNews(row, inst?.symbol ?? null))
      .filter((n): n is NewsItem => n !== null)
      .slice(0, limit);
  },

  async fetchFundamentals(inst: Instrument): Promise<Fundamentals | null> {
    const raw = await providerFetch<{ metric?: Record<string, unknown> }>(
      url("/stock/metric", { symbol: inst.symbol, metric: "all" }),
      { provider: ID, maxWaitMs: 900 },
    );
    const m = raw.metric;
    if (!m) return null;

    const capMillions = num(m["marketCapitalization"]);

    return {
      symbol: inst.symbol,
      marketCap: capMillions != null ? capMillions * 1e6 : null,
      peRatio: num(m["peTTM"]) ?? num(m["peBasicExclExtraTTM"]),
      pegRatio: num(m["pegTTM"]),
      priceToBook: num(m["pbQuarterly"]) ?? num(m["pbAnnual"]),
      priceToSales: num(m["psTTM"]),
      eps: num(m["epsTTM"]) ?? num(m["epsBasicExclExtraItemsTTM"]),
      revenue: num(m["revenuePerShareTTM"]),
      revenueGrowth: num(m["revenueGrowthTTMYoy"]),
      grossMargin: num(m["grossMarginTTM"]),
      operatingMargin: num(m["operatingMarginTTM"]),
      netMargin: num(m["netProfitMarginTTM"]),
      roe: num(m["roeTTM"]),
      roa: num(m["roaTTM"]),
      debtToEquity: num(m["totalDebt/totalEquityQuarterly"]),
      currentRatio: num(m["currentRatioQuarterly"]),
      dividendYield: num(m["dividendYieldIndicatedAnnual"]),
      beta: num(m["beta"]),
      sharesOutstanding: num(m["shareOutstanding"]) != null ? num(m["shareOutstanding"])! * 1e6 : null,
      asOf: null,
      provider: ID,
    };
  },

  async fetchRecommendations(inst: Instrument): Promise<AnalystConsensus | null> {
    const raw = await providerFetch<unknown[]>(
      url("/stock/recommendation", { symbol: inst.symbol }),
      { provider: ID, maxWaitMs: 700 },
    );
    if (!Array.isArray(raw) || raw.length === 0) return null;

    // Finnhub returns newest first.
    const latest = raw[0] as Record<string, unknown>;
    const strongBuy = num(latest["strongBuy"]) ?? 0;
    const buy = num(latest["buy"]) ?? 0;
    const hold = num(latest["hold"]) ?? 0;
    const sell = num(latest["sell"]) ?? 0;
    const strongSell = num(latest["strongSell"]) ?? 0;
    const total = strongBuy + buy + hold + sell + strongSell;
    if (total === 0) return null;

    // Weighted mean on the conventional 1–5 scale.
    const score = (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / total;

    let targetHigh: number | null = null;
    let targetLow: number | null = null;
    let targetMean: number | null = null;
    try {
      const pt = await providerFetch<Record<string, unknown>>(
        url("/stock/price-target", { symbol: inst.symbol }),
        { provider: ID, maxWaitMs: 500 },
      );
      targetHigh = num(pt["targetHigh"]);
      targetLow = num(pt["targetLow"]);
      targetMean = num(pt["targetMean"]);
    } catch {
      // Price targets are a premium endpoint on some plans. The consensus
      // breakdown is the valuable half and stands on its own.
    }

    return {
      symbol: inst.symbol,
      strongBuy, buy, hold, sell, strongSell,
      score,
      total,
      period: str(latest["period"]),
      targetHigh,
      targetLow,
      targetMean,
      provider: ID,
    };
  },

  async fetchEarnings(inst: Instrument): Promise<EarningsPoint[]> {
    const raw = await providerFetch<unknown[]>(url("/stock/earnings", { symbol: inst.symbol }), {
      provider: ID,
      maxWaitMs: 700,
    });
    if (!Array.isArray(raw)) return [];

    const points: EarningsPoint[] = [];
    for (const row of raw) {
      const r = row as Record<string, unknown>;
      const period = str(r["period"]);
      if (!period) continue;

      const actual = num(r["actual"]);
      const estimate = num(r["estimate"]);

      points.push({
        period,
        reportedAt: isoDayMs(period),
        epsActual: actual,
        epsEstimate: estimate,
        surprisePercent:
          num(r["surprisePercent"]) ??
          (actual != null && estimate != null && estimate !== 0
            ? ((actual - estimate) / Math.abs(estimate)) * 100
            : null),
        revenueActual: null,
        revenueEstimate: null,
      });
    }

    return points.sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0)).slice(0, 8);
  },

  /**
   * Insider transactions.
   *
   * Filed with the SEC and republished here. The signal worth extracting is
   * net direction over recent months rather than any single filing — a chief
   * executive selling on a schedule is noise, several officers buying in the
   * same quarter is not.
   */
  async fetchInsiderTransactions(inst: Instrument): Promise<InsiderTrade[]> {
    const raw = await providerFetch<{ data?: unknown[] }>(
      url("/stock/insider-transactions", { symbol: inst.symbol }),
      { provider: ID, maxWaitMs: 700 },
    );
    if (!Array.isArray(raw.data)) return [];

    const trades: InsiderTrade[] = [];
    for (const row of raw.data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;

      const name = str(r["name"]);
      const change = num(r["change"]);
      const filed = str(r["filingDate"]);
      if (!name || change == null || change === 0 || !filed) continue;

      const price = num(r["transactionPrice"]);
      const code = str(r["transactionCode"]);

      trades.push({
        name,
        shares: Math.abs(change),
        // A gift or an award is a transfer, not a purchase, and lumping it in
        // with open-market buying is how insider data gets misread.
        direction: change > 0 ? "buy" : "sell",
        openMarket: code === "P" || code === "S",
        code,
        price: price != null && price > 0 ? price : null,
        value: price != null && price > 0 ? Math.abs(change) * price : null,
        filedAt: Date.parse(filed) || null,
        transactedAt: str(r["transactionDate"]) ? Date.parse(str(r["transactionDate"])!) || null : null,
      });
    }

    return trades
      .sort((a, b) => (b.transactedAt ?? b.filedAt ?? 0) - (a.transactedAt ?? a.filedAt ?? 0))
      .slice(0, 40);
  },

  async fetchPeers(inst: Instrument): Promise<string[]> {
    const raw = await providerFetch<unknown>(url("/stock/peers", { symbol: inst.symbol }), {
      provider: ID,
      maxWaitMs: 500,
    });
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is string => typeof s === "string")
      .filter((s) => s.toUpperCase() !== inst.symbol.toUpperCase())
      .slice(0, 8);
  },
};

/* ── Insider and IPO types ────────────────────────────────────────────────── */

export interface InsiderTrade {
  name: string;
  shares: number;
  direction: "buy" | "sell";
  /** True for an open-market purchase or sale, false for grants and gifts. */
  openMarket: boolean;
  code: string | null;
  price: number | null;
  value: number | null;
  filedAt: number | null;
  transactedAt: number | null;
}

export interface IpoEntry {
  symbol: string | null;
  name: string;
  exchange: string | null;
  date: string;
  status: string | null;
  shares: number | null;
  priceRange: string | null;
  totalValue: number | null;
}

/**
 * Upcoming and recent listings.
 *
 * A calendar of what is about to start trading — the one part of the market
 * that has no price history to look at, and so is exactly where a calendar
 * earns its place.
 */
export async function fetchIpoCalendar(from: string, to: string): Promise<IpoEntry[]> {
  const raw = await providerFetch<{ ipoCalendar?: unknown[] }>(
    url("/calendar/ipo", { from, to }),
    { provider: ID, maxWaitMs: 1200 },
  );
  if (!Array.isArray(raw.ipoCalendar)) return [];

  const out: IpoEntry[] = [];
  for (const row of raw.ipoCalendar) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;

    const name = str(r["name"]);
    const date = str(r["date"]);
    if (!name || !date) continue;

    out.push({
      symbol: str(r["symbol"]),
      name,
      exchange: str(r["exchange"]),
      date,
      status: str(r["status"]),
      shares: num(r["numberOfShares"]),
      priceRange: str(r["price"]),
      totalValue: num(r["totalSharesValue"]),
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function normaliseNews(row: unknown, fallbackSymbol: string | null): NewsItem | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const headline = str(r["headline"]);
  const url = str(r["url"]);
  if (!headline || !url) return null;

  const related = str(r["related"]);
  const symbols = related
    ? related.split(",").map((s) => s.trim()).filter(Boolean)
    : fallbackSymbol
      ? [fallbackSymbol]
      : [];

  return {
    id: String(r["id"] ?? url),
    headline,
    summary: str(r["summary"]),
    source: str(r["source"]) ?? "Finnhub",
    url,
    publishedAt: epochMs(r["datetime"]) ?? Date.now(),
    symbols,
    imageUrl: str(r["image"]),
    category: str(r["category"]),
  };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `Q1 2026` or `2026-03-31` to epoch ms, best effort. */
function isoDayMs(period: string): number | null {
  const t = Date.parse(period);
  return Number.isNaN(t) ? null : t;
}

export { ID as FINNHUB_ID };
