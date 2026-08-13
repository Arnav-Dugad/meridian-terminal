import "server-only";

import { cached, peek } from "@/lib/twelvedata/cache";
import { readCachedQuotes, writeCachedQuotes } from "@/lib/firebase/quote-cache";
import * as registry from "@/lib/providers/registry";
import { fetchExchangeRate, twelveDataMeta } from "@/lib/providers/twelvedata";
import { fetchFxRate } from "@/lib/providers/yahoo";
import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
  NewsItem,
} from "@/lib/providers/types";
import type {
  CompanyProfile,
  DataFailure,
  DataSource,
  FxRate,
  MarketBreadth,
  Quote,
  RangeKey,
  SectorAggregate,
  Series,
} from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";
import type { ExchangeCode, Region } from "@/lib/market/exchanges";
import { EXCHANGES, sessionState } from "@/lib/market/exchanges";
import type { Instrument, Sector } from "@/lib/market/universe";
import { findBySlug, SECTORS } from "@/lib/market/universe";

/**
 * The service layer: everything above this asks for domain objects and gets
 * them, always.
 *
 * Routing across providers is the registry's job. What lives here is the
 * policy on top of it — caching windows, and the degradation ladder that turns
 * an outage into a labelled fallback rather than an error page:
 *
 *     live provider  →  last good cached value  →  simulation
 *
 * The resulting `source` is propagated to the UI so nothing is ever presented
 * as real when it is not.
 */

export interface Resolved<T> {
  data: T;
  source: DataSource;
  notice?: string;
  /** Provider ids that contributed, for attribution. */
  providers?: string[];
  /** Instruments no provider could answer for, with the reason why. */
  failures?: DataFailure[];
}

/**
 * Turn whatever a provider chain threw into something a reader can act on.
 *
 * The distinction that matters is transient versus structural: a rate limit
 * clears in a minute and is worth a retry button, while a symbol outside your
 * plan will never resolve and needs a different answer entirely.
 */
function describeFailure(inst: Instrument, err: unknown): DataFailure {
  const message = err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();

  if (lower.includes("429") || lower.includes("rate") || lower.includes("budget")) {
    return {
      slug: inst.slug,
      symbol: inst.symbol,
      reason: "Rate limit reached on every data source that covers this instrument.",
      transient: true,
    };
  }
  if (lower.includes("plan") || lower.includes("grow") || lower.includes("subscription")) {
    return {
      slug: inst.slug,
      symbol: inst.symbol,
      reason: "This listing is not included in the current data plan.",
      transient: false,
    };
  }
  if (lower.includes("timed out") || lower.includes("abort") || lower.includes("504")) {
    return {
      slug: inst.slug,
      symbol: inst.symbol,
      reason: "The data source timed out.",
      transient: true,
    };
  }
  if (lower.includes("bot protection") || lower.includes("403")) {
    return {
      slug: inst.slug,
      symbol: inst.symbol,
      reason: "The exchange is refusing automated requests right now.",
      transient: true,
    };
  }

  return {
    slug: inst.slug,
    symbol: inst.symbol,
    reason: message ? `No data source returned a price (${message.slice(0, 80)}).` : "No data source returned a price.",
    transient: true,
  };
}

/* ── Quotes ───────────────────────────────────────────────────────────────── */

/**
 * Cache windows are per-exchange because a closed market's prices do not
 * change: refreshing NSE every twelve seconds overnight spends a scarce budget
 * to re-fetch a constant. Crypto never closes, so it is always on the short
 * window.
 */
function quoteTtl(exchange: ExchangeCode): number {
  // CoinGecko's keyless tier is the tightest per-minute budget in the stack
  // relative to how often crypto panels appear, and a batch call refreshes
  // every coin at once — so a slightly longer window costs nothing in
  // freshness and keeps the budget from being drained by page loads alone.
  if (exchange === "CRYPTO") return 30_000;
  return sessionState(exchange).isLive ? 12_000 : 180_000;
}

function quoteKey(inst: Instrument) {
  return `quote:${inst.slug}`;
}

export async function getQuotes(slugs: string[]): Promise<Resolved<Quote[]>> {
  const instruments = slugs
    .map((s) => findBySlug(s))
    .filter((i): i is Instrument => Boolean(i));

  if (instruments.length === 0) return { data: [], source: "cached" };

  /*
   * Three tiers, cheapest first.
   *
   *   1. process cache   — free, but scoped to one warm instance
   *   2. Firestore       — ~1ms, shared across every instance and cold start
   *   3. provider        — 150–600ms and metered against a per-minute budget
   *
   * Tier 2 is what makes an 8-credit-a-minute plan survive real traffic: a
   * figure fetched by one instance is available to all of them, so a cold
   * start no longer re-spends budget on quotes that were already paid for.
   */
  const fresh = new Map<string, Quote>();
  const stale: Instrument[] = [];
  for (const inst of instruments) {
    const hit = peek<Quote>(quoteKey(inst));
    if (hit && !hit.stale) fresh.set(inst.slug, hit.value);
    else stale.push(inst);
  }

  let remaining = stale;

  if (remaining.length > 0) {
    const shared = await readCachedQuotes(remaining.map((i) => i.slug));
    if (shared.size > 0) {
      for (const [slug, quote] of shared) {
        fresh.set(slug, quote);
        const inst = findBySlug(slug);
        // Promote into the process cache so the next request this instance
        // serves does not pay even the Firestore round trip.
        if (inst) {
          const ttl = quoteTtl(inst.exchange);
          void cached(quoteKey(inst), { ttl, maxAge: ttl * 20 }, async () => quote);
        }
      }
      remaining = remaining.filter((i) => !shared.has(i.slug));
    }
  }

  // Retained so a failure can be described specifically rather than generically.
  let lastError: unknown = null;

  if (remaining.length > 0 && registry.configuredProviderCount() > 0) {
    try {
      const result = await registry.fetchQuotes(remaining);

      for (const quote of result.quotes) {
        fresh.set(quote.slug, quote);
        const inst = findBySlug(quote.slug);
        if (inst) {
          const ttl = quoteTtl(inst.exchange);
          void cached(quoteKey(inst), { ttl, maxAge: ttl * 20 }, async () => quote);
        }
      }

      // Publish to the shared tier without blocking the response. The TTL is
      // taken from the shortest-lived instrument in the batch so a 24/7 crypto
      // window never extends a closed equity market's.
      if (result.quotes.length > 0) {
        const ttl = Math.min(
          ...result.quotes.map((q) => {
            const inst = findBySlug(q.slug);
            return inst ? quoteTtl(inst.exchange) : 30_000;
          }),
        );
        void writeCachedQuotes(result.quotes, ttl);
      }
    } catch (err) {
      // The registry already failed over internally; reaching here means every
      // provider is down. Keep the reason so the gap can be explained.
      lastError = err;
    }
  }

  /*
   * Fill gaps from cache, and *omit* anything still missing.
   *
   * Nothing is invented here. An instrument no provider could price is left
   * out of the result and recorded as a failure, so the interface renders an
   * explicit gap with a reason rather than a plausible fabricated price the
   * reader has no way to distinguish from a real one.
   */
  let degraded = false;
  const data: Quote[] = [];
  const failures: DataFailure[] = [];

  for (const inst of instruments) {
    const live = fresh.get(inst.slug);
    if (live) {
      data.push(live);
      continue;
    }

    const lastGood = peek<Quote>(quoteKey(inst));
    if (lastGood) {
      degraded = true;
      data.push({ ...lastGood.value, source: "cached" as const });
      continue;
    }

    degraded = true;
    failures.push(describeFailure(inst, lastError));
  }

  const source: DataSource = degraded ? "cached" : "live";

  // Attribution is derived from the returned quotes rather than from what this
  // call happened to fetch. A quote served from a fresh cache entry is still
  // that provider's number, and dropping the credit because we did not re-ask
  // for it produced an empty provider list on any warm request.
  const providers = Array.from(
    new Set(data.map((q) => q.provider).filter((p): p is string => Boolean(p))),
  );

  return {
    data,
    source,
    providers,
    ...(failures.length > 0 ? { failures } : {}),
    notice: failures.length > 0 ? unavailableNotice(failures, instruments.length) : undefined,
  };
}

/** One line summarising what could not be priced, and whether to retry. */
function unavailableNotice(failures: DataFailure[], requested: number): string {
  if (registry.configuredProviderCount() === 0) {
    return "No market data provider is configured, so no prices can be shown.";
  }

  const transient = failures.filter((f) => f.transient).length;
  const scope =
    failures.length === requested
      ? "No prices could be retrieved"
      : `${failures.length} of ${requested} instruments could not be priced`;

  return transient === failures.length
    ? `${scope} — the data sources are rate-limited or unreachable. This usually clears within a minute.`
    : `${scope}. ${failures[0]?.reason ?? ""}`;
}

/* ── Time series ──────────────────────────────────────────────────────────── */

export async function getSeries(slug: string, range: RangeKey): Promise<Resolved<Series>> {
  const inst = findBySlug(slug);
  if (!inst) throw new Error(`Unknown instrument: ${slug}`);

  const spec = RANGE_SPEC[range];
  const intraday = spec.interval.includes("min") || spec.interval === "1h";
  const ttl = intraday ? 60_000 : 900_000;
  const key = `series:${inst.slug}:${range}`;

  const wrap = (candles: Series["candles"], source: DataSource): Series => ({
    symbol: inst.symbol,
    slug: inst.slug,
    interval: spec.interval,
    range,
    currency: inst.currency,
    candles,
    source,
  });

  try {
    const { value, stale } = await cached(key, { ttl, maxAge: ttl * 24 }, async () => {
      const result = await registry.fetchSeries(inst, range);
      if (!result || result.candles.length === 0) throw new Error("no history returned");
      return result;
    });

    return {
      data: wrap(value.candles, stale ? "cached" : "live"),
      source: stale ? "cached" : "live",
      providers: [value.provider],
    };
  } catch (err) {
    const lastGood = peek<{ candles: Series["candles"] }>(key);
    if (lastGood && lastGood.value.candles.length > 0) {
      return {
        data: wrap(lastGood.value.candles, "cached"),
        source: "cached",
        notice: "Showing the last successfully retrieved history.",
      };
    }

    // An empty candle array with a stated reason, rather than a fabricated
    // curve. The chart renders its unavailable state from this.
    const failure = describeFailure(inst, err);
    return {
      data: wrap([], "cached"),
      source: "cached",
      notice: failure.reason,
      failures: [failure],
    };
  }
}

/* ── Breadth endpoints ────────────────────────────────────────────────────── */

export async function getNews(slug: string | null, limit = 20): Promise<Resolved<NewsItem[]>> {
  const inst = (slug ? findBySlug(slug) : null) ?? null;
  if (slug && !inst) return { data: [], source: "cached" };

  const key = `news:${inst?.slug ?? "market"}`;
  try {
    // News is expensive relative to its rate of change; ten minutes is plenty.
    const { value, stale } = await cached(key, { ttl: 600_000, maxAge: 3_600_000 }, async () => {
      const result = await registry.fetchNews(inst, limit);
      if (!result || result.items.length === 0) throw new Error("no news returned");
      return result;
    });
    return {
      data: value.items.slice(0, limit),
      source: stale ? "cached" : "live",
      providers: [value.provider],
    };
  } catch {
    return {
      data: [],
      source: "cached",
      notice: inst && inst.region !== "US"
        ? "Company news is only available for US listings on the data sources in use."
        : "No news source is currently reachable.",
    };
  }
}

export async function getFundamentals(slug: string): Promise<Resolved<Fundamentals | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "cached" };

  try {
    // Fundamentals change quarterly. A day is conservative.
    const { value, stale } = await cached(
      `fundamentals:${inst.slug}`,
      { ttl: 86_400_000, maxAge: 172_800_000 },
      async () => {
        const result = await registry.fetchFundamentals(inst);
        if (!result) throw new Error("no fundamentals");
        return result;
      },
    );
    return { data: value, source: stale ? "cached" : "live", providers: [value.provider] };
  } catch {
    return { data: null, source: "cached" };
  }
}

export async function getRecommendations(slug: string): Promise<Resolved<AnalystConsensus | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "cached" };

  try {
    const { value, stale } = await cached(
      `recs:${inst.slug}`,
      { ttl: 43_200_000, maxAge: 172_800_000 },
      async () => {
        const result = await registry.fetchRecommendations(inst);
        if (!result) throw new Error("no recommendations");
        return result;
      },
    );
    return { data: value, source: stale ? "cached" : "live", providers: [value.provider] };
  } catch {
    return { data: null, source: "cached" };
  }
}

export async function getEarnings(slug: string): Promise<Resolved<EarningsPoint[]>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: [], source: "cached" };

  try {
    const { value, stale } = await cached(
      `earnings:${inst.slug}`,
      { ttl: 43_200_000, maxAge: 172_800_000 },
      async () => {
        const result = await registry.fetchEarnings(inst);
        if (result.length === 0) throw new Error("no earnings");
        return result;
      },
    );
    return { data: value, source: stale ? "cached" : "live" };
  } catch {
    return { data: [], source: "cached" };
  }
}

export async function getPeers(slug: string): Promise<Resolved<string[]>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: [], source: "cached" };

  try {
    const { value } = await cached(`peers:${inst.slug}`, { ttl: 604_800_000 }, async () => {
      const result = await registry.fetchPeers(inst);
      if (result.length === 0) throw new Error("no peers");
      return result;
    });
    return { data: value, source: "live" };
  } catch {
    return { data: [], source: "cached" };
  }
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

export async function getProfile(slug: string): Promise<Resolved<CompanyProfile | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "cached" };

  const { data: fundamentals } = await getFundamentals(slug);
  if (!fundamentals) return { data: null, source: "cached" };

  return {
    data: {
      symbol: inst.symbol,
      name: inst.name,
      exchange: inst.exchange,
      currency: inst.currency,
      sector: inst.sector,
      industry: null,
      description: null,
      website: null,
      employees: null,
      ceo: null,
      country: EXCHANGES[inst.exchange].country,
      source: "live",
    },
    source: "live",
  };
}

/* ── FX ───────────────────────────────────────────────────────────────────── */

/**
 * The exchange rate.
 *
 * Two independent sources, because this is the denominator of every portfolio
 * total and a missing rate would blank the entire page. Yahoo's `USDINR=X` is
 * free and unmetered; Twelve Data is the fallback where a key exists.
 *
 * `rate` is null when neither answers, and the portfolio renders native
 * currencies separately rather than inventing a conversion.
 */
export async function getFx(pair = "USD/INR"): Promise<Resolved<FxRate | null>> {
  try {
    const { value, stale } = await cached(
      `fx:${pair}`,
      { ttl: 300_000, maxAge: 21_600_000 },
      async () => {
        const viaYahoo = await fetchFxRate(pair);
        if (viaYahoo != null) return viaYahoo;

        if (twelveDataMeta.configured) {
          const viaTwelve = await fetchExchangeRate(pair);
          if (viaTwelve != null) return viaTwelve;
        }
        throw new Error("no exchange rate available");
      },
    );

    return {
      data: { pair, rate: value, timestamp: Date.now(), source: stale ? "cached" : "live" },
      source: stale ? "cached" : "live",
    };
  } catch {
    return {
      data: null,
      source: "cached",
      notice: `No source could provide the ${pair} rate. Totals are shown in each holding's own currency.`,
    };
  }
}

/* ── Derived analytics ────────────────────────────────────────────────────── */

/**
 * Breadth is computed locally from quotes we already hold rather than bought
 * from a dedicated endpoint. It costs nothing extra and stays consistent with
 * whatever the reader is actually looking at.
 */
export function computeBreadth(quotes: Quote[], region: Region): MarketBreadth {
  const rows = quotes.filter((q) => q.region === region && q.sector !== "Index");
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let capSum = 0;
  let capWeighted = 0;
  let simpleSum = 0;

  for (const q of rows) {
    if (q.changePercent > 0.02) advancing++;
    else if (q.changePercent < -0.02) declining++;
    else unchanged++;
    const cap = q.marketCap ?? 0;
    capSum += cap;
    capWeighted += cap * q.changePercent;
    simpleSum += q.changePercent;
  }

  const total = rows.length || 1;
  return {
    region,
    advancing,
    declining,
    unchanged,
    weightedChange: capSum > 0 ? capWeighted / capSum : simpleSum / total,
    meanChange: simpleSum / total,
    ratio: advancing + declining > 0 ? advancing / (advancing + declining) : 0.5,
  };
}

export function computeSectors(quotes: Quote[], region: Region): SectorAggregate[] {
  const out: SectorAggregate[] = [];

  for (const sector of SECTORS) {
    const rows = quotes.filter((q) => q.region === region && q.sector === sector);
    if (rows.length === 0) continue;

    let capSum = 0;
    let weighted = 0;
    let advancing = 0;
    for (const q of rows) {
      const cap = q.marketCap ?? 1;
      capSum += cap;
      weighted += cap * q.changePercent;
      if (q.changePercent > 0) advancing++;
    }

    const leaders = rows
      .slice()
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 3)
      .map((q) => ({ slug: q.slug, symbol: q.symbol, changePercent: q.changePercent }));

    out.push({
      sector: sector as Sector,
      region,
      changePercent: capSum > 0 ? weighted / capSum : 0,
      weight: capSum,
      count: rows.length,
      advancing,
      leaders,
    });
  }

  return out.sort((a, b) => b.changePercent - a.changePercent);
}

export function marketStatusSnapshot() {
  return (["NSE", "BSE", "NASDAQ", "NYSE", "CRYPTO"] as ExchangeCode[]).map((code) => ({
    code,
    name: EXCHANGES[code].name,
    region: EXCHANGES[code].region,
    ...sessionState(code),
  }));
}
