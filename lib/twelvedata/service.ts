import "server-only";

import { cached, peek } from "@/lib/twelvedata/cache";
import { readCachedQuotes, writeCachedQuotes } from "@/lib/firebase/quote-cache";
import { simulateFx, simulateQuote, simulateSeries } from "@/lib/twelvedata/simulate";
import * as registry from "@/lib/providers/registry";
import { fetchExchangeRate, twelveDataMeta } from "@/lib/providers/twelvedata";
import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
  NewsItem,
} from "@/lib/providers/types";
import type {
  CompanyProfile,
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

  if (instruments.length === 0) return { data: [], source: "simulated" };

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
    } catch {
      // The registry already failed over internally; reaching here means every
      // provider is down. Fall through to cache, then simulation.
    }
  }

  // Fill any remaining gaps, worst case last.
  let degraded = false;
  const data: Quote[] = instruments.map((inst) => {
    const live = fresh.get(inst.slug);
    if (live) return live;

    const lastGood = peek<Quote>(quoteKey(inst));
    if (lastGood) {
      degraded = true;
      return { ...lastGood.value, source: "cached" as const };
    }

    degraded = true;
    return simulateQuote(inst);
  });

  const simulatedCount = data.filter((q) => q.source === "simulated").length;
  const source: DataSource =
    simulatedCount === data.length ? "simulated" : degraded ? "cached" : "live";

  // Attribution is derived from the returned quotes rather than from what this
  // call happened to fetch. A quote served from a fresh cache entry is still
  // that provider's number, and dropping the credit because we did not re-ask
  // for it produced an empty provider list on any warm request.
  const providers = Array.from(
    new Set(data.map((q) => q.provider).filter((p): p is string => Boolean(p))),
  );

  const liveCount = data.filter((q) => q.source === "live").length;

  return {
    data,
    source,
    providers,
    notice: degraded ? degradationNotice(data, simulatedCount, liveCount) : undefined,
  };
}

/**
 * Explains *which* instruments degraded and why, rather than a generic banner.
 * The common real-world case — a Twelve Data plan that does not include the
 * Indian exchanges — is worth naming explicitly, because it looks like a bug
 * and is actually a subscription boundary.
 */
function degradationNotice(data: Quote[], simulatedCount: number, liveCount: number): string {
  const simulatedIndia = data.filter((q) => q.source === "simulated" && q.region === "IN");
  const simulatedOther = data.filter((q) => q.source === "simulated" && q.region !== "IN");

  if (simulatedCount === 0) {
    return "Some values were served from cache rather than re-fetched.";
  }

  // The India-only case is worth naming specifically: it looks like a bug and
  // is actually a plan boundary, and the fix is different from every other
  // degradation here.
  if (simulatedIndia.length > 0 && simulatedOther.length === 0) {
    return twelveDataMeta.configured
      ? "Indian listings are simulated. Twelve Data's free tier covers US markets only — NSE and BSE need a paid plan."
      : "Indian listings are simulated — no TWELVE_DATA_API_KEY configured.";
  }

  if (simulatedCount === data.length) {
    return registry.configuredProviderCount() === 0
      ? "Simulated market — no data provider is configured. See the Markets page for which keys unlock what."
      : "Every provider was rate-limited or unreachable; showing simulated values.";
  }

  const detail = simulatedIndia.length > 0 && simulatedOther.length > 0 ? " (including Indian listings)" : "";
  return liveCount > 0
    ? `${simulatedCount} of ${data.length} instruments are simulated${detail} — the rest are live or cached.`
    : `${simulatedCount} of ${data.length} instruments are simulated${detail}.`;
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

  if (registry.configuredProviderCount() === 0 && inst.kind !== "crypto") {
    return {
      data: simulateSeries(inst, range),
      source: "simulated",
      notice: "Simulated history — no data provider is configured.",
    };
  }

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
  } catch {
    const lastGood = peek<{ candles: Series["candles"] }>(key);
    if (lastGood && lastGood.value.candles.length > 0) {
      return {
        data: wrap(lastGood.value.candles, "cached"),
        source: "cached",
        notice: "Showing the last successfully retrieved history.",
      };
    }
    return {
      data: simulateSeries(inst, range),
      source: "simulated",
      notice: "History unavailable from every provider; showing a simulated series.",
    };
  }
}

/* ── Breadth endpoints ────────────────────────────────────────────────────── */

export async function getNews(slug: string | null, limit = 20): Promise<Resolved<NewsItem[]>> {
  const inst = (slug ? findBySlug(slug) : null) ?? null;
  if (slug && !inst) return { data: [], source: "simulated" };

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
      source: "simulated",
      notice: inst && inst.region !== "US"
        ? "Company news is only available for US listings on the free tiers in use."
        : "No news provider is configured. Add FINNHUB_API_KEY to enable this panel.",
    };
  }
}

export async function getFundamentals(slug: string): Promise<Resolved<Fundamentals | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "simulated" };

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
    return { data: null, source: "simulated" };
  }
}

export async function getRecommendations(slug: string): Promise<Resolved<AnalystConsensus | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "simulated" };

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
    return { data: null, source: "simulated" };
  }
}

export async function getEarnings(slug: string): Promise<Resolved<EarningsPoint[]>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: [], source: "simulated" };

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
    return { data: [], source: "simulated" };
  }
}

export async function getPeers(slug: string): Promise<Resolved<string[]>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: [], source: "simulated" };

  try {
    const { value } = await cached(`peers:${inst.slug}`, { ttl: 604_800_000 }, async () => {
      const result = await registry.fetchPeers(inst);
      if (result.length === 0) throw new Error("no peers");
      return result;
    });
    return { data: value, source: "live" };
  } catch {
    return { data: [], source: "simulated" };
  }
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

export async function getProfile(slug: string): Promise<Resolved<CompanyProfile | null>> {
  const inst = findBySlug(slug);
  if (!inst || inst.kind !== "equity") return { data: null, source: "simulated" };

  const { data: fundamentals } = await getFundamentals(slug);
  if (!fundamentals) return { data: null, source: "simulated" };

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

export async function getFx(pair = "USD/INR"): Promise<Resolved<FxRate>> {
  const fallback = (): Resolved<FxRate> => ({
    data: { pair, rate: simulateFx(pair), timestamp: Date.now(), source: "simulated" },
    source: "simulated",
  });

  if (!twelveDataMeta.configured) return fallback();

  try {
    const { value, stale } = await cached(
      `fx:${pair}`,
      { ttl: 300_000, maxAge: 3_600_000 },
      async () => {
        const rate = await fetchExchangeRate(pair);
        if (rate == null) throw new Error("no rate");
        return rate;
      },
    );
    return {
      data: { pair, rate: value, timestamp: Date.now(), source: stale ? "cached" : "live" },
      source: stale ? "cached" : "live",
    };
  } catch {
    return fallback();
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
