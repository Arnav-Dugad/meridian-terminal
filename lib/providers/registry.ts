import "server-only";

import { alphaVantage } from "@/lib/providers/alphavantage";
import { coingecko } from "@/lib/providers/coingecko";
import { finnhub } from "@/lib/providers/finnhub";
import { fmp } from "@/lib/providers/fmp";
import { twelveData } from "@/lib/providers/twelvedata";
import { yahoo } from "@/lib/providers/yahoo";
import { yahooSummary } from "@/lib/providers/yahoo-summary";
import { canSpend, limiterSnapshot } from "@/lib/providers/limiter";
import type {
  AnalystConsensus,
  Capability,
  EarningsPoint,
  Fundamentals,
  NewsItem,
  QuoteProvider,
} from "@/lib/providers/types";
import type { Instrument } from "@/lib/market/universe";
import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";

/**
 * Provider routing.
 *
 * Two rules govern every chain below.
 *
 * **1. Route to who actually has coverage.**
 * Twelve Data's free tier returns a hard 404 for NSE and BSE symbols — they
 * need the Grow plan — so on a free stack there was no route to an Indian
 * quote at all, and India fell through to simulation regardless of budget.
 * Yahoo serves NSE, BSE, both countries' indices and crypto with no key, which
 * is why it leads the Indian chain and backs up every other one.
 *
 * **2. Spend the scarcest budget last.**
 *
 *   Yahoo         ~60/min  → India, indices, and a universal fallback
 *   Finnhub        60/min  → US quotes, news, consensus, earnings, peers
 *   CoinGecko     ~12/min  → crypto (batches the whole set in one call)
 *   Twelve Data     8/min  → US-only on the free tier; kept for paid plans
 *   FMP          250/day   → fundamentals only, cached for a day
 *   Alpha Vantage  25/day  → spare tyre; notably *does* reach BSE
 *
 * Chains skip providers that are unconfigured or already out of budget, so a
 * failover costs no wall time when the answer is knowable up front.
 */

const ALL_PROVIDERS: QuoteProvider[] = [
  yahoo,
  yahooSummary,
  finnhub,
  coingecko,
  twelveData,
  fmp,
  alphaVantage,
];

function isConfigured(p: QuoteProvider): boolean {
  return p.meta.configured;
}

/** Ordered candidates for a capability against a given instrument. */
function chainFor(capability: Capability, inst: Instrument): QuoteProvider[] {
  const chain: QuoteProvider[] = [];

  if (inst.kind === "crypto") {
    // CoinGecko first because it batches — one call prices every coin on the
    // page, where Yahoo needs one per symbol.
    if (capability === "quote" || capability === "series") chain.push(coingecko, yahoo);
    return chain.filter(isConfigured);
  }

  switch (capability) {
    case "quote":
      if (inst.region === "IN") {
        // Yahoo is the only free route to NSE and BSE. Alpha Vantage is a real
        // fallback here — it reaches BSE — but at 25 calls a day it is a
        // last resort, not a tier.
        chain.push(yahoo, twelveData, alphaVantage);
      } else {
        // US: Finnhub leads on budget and carries the day's range; Yahoo backs
        // it up and also supplies the 52-week band Finnhub's quote omits.
        chain.push(finnhub, yahoo, twelveData, alphaVantage);
      }
      break;

    case "series":
      // Finnhub's free candle endpoint is restricted and Twelve Data cannot
      // reach India, so Yahoo carries history for both regions.
      chain.push(yahoo, twelveData, alphaVantage);
      break;

    case "fundamentals":
      // Yahoo leads because it is the only free source that covers Indian
      // listings — without it, NSE names have a chart and no research at all.
      // FMP is richer where it applies; Finnhub backs both up.
      chain.push(yahooSummary);
      if (inst.region === "US") chain.push(fmp, finnhub);
      break;

    case "recommendations":
      // Same reason: analyst coverage for NSE exists nowhere else free.
      chain.push(yahooSummary);
      if (inst.region === "US") chain.push(finnhub);
      break;

    case "earnings":
      chain.push(yahooSummary);
      if (inst.region === "US") chain.push(finnhub, fmp);
      break;

    case "news":
    case "peers":
      if (inst.region === "US") chain.push(finnhub);
      break;

    default:
      break;
  }

  return chain.filter(isConfigured);
}

/**
 * Try each provider in turn, returning the first non-empty result.
 * A provider that is out of budget is skipped without a request.
 */
async function firstOf<T>(
  chain: QuoteProvider[],
  cost: number,
  run: (p: QuoteProvider) => Promise<T | null>,
  isEmpty: (v: T) => boolean,
): Promise<{ value: T; provider: string } | null> {
  for (const provider of chain) {
    if (!canSpend(provider.meta.id, cost)) continue;
    try {
      const value = await run(provider);
      if (value != null && !isEmpty(value)) {
        return { value, provider: provider.meta.id };
      }
    } catch {
      // Every provider error is a failover signal; the chain is the recovery.
    }
  }
  return null;
}

/* ── Quotes ───────────────────────────────────────────────────────────────── */

export interface QuoteResult {
  quotes: Quote[];
  /** Provider ids that actually contributed. */
  providers: string[];
}

/**
 * Fetch quotes for a mixed set of instruments.
 *
 * Instruments are bucketed by their routing class, each bucket is served by
 * its own chain in parallel, and anything still missing after the first pass
 * falls through to the next provider that covers it. Buckets run concurrently
 * because they draw on independent budgets — a Finnhub call and a Twelve Data
 * call do not compete.
 */
export async function fetchQuotes(instruments: Instrument[]): Promise<QuoteResult> {
  if (instruments.length === 0) return { quotes: [], providers: [] };

  const crypto = instruments.filter((i) => i.kind === "crypto");
  const us = instruments.filter((i) => i.kind !== "crypto" && i.region === "US");
  const india = instruments.filter((i) => i.kind !== "crypto" && i.region === "IN");

  const found = new Map<string, Quote>();
  const providers = new Set<string>();

  const runBucket = async (bucket: Instrument[]) => {
    if (bucket.length === 0) return;
    const sample = bucket[0]!;
    const chain = chainFor("quote", sample);

    let remaining = bucket;
    for (const provider of chain) {
      if (remaining.length === 0) break;
      if (!provider.fetchQuotes) continue;
      if (!canSpend(provider.meta.id, 1)) continue;

      try {
        const quotes = await provider.fetchQuotes(remaining);
        for (const q of quotes) found.set(q.slug, q);
        if (quotes.length > 0) providers.add(provider.meta.id);
        const got = new Set(quotes.map((q) => q.slug));
        remaining = remaining.filter((i) => !got.has(i.slug));
      } catch {
        // Next provider in the chain.
      }
    }
  };

  await Promise.all([runBucket(crypto), runBucket(us), runBucket(india)]);

  // Finnhub's quote carries no market cap and no volume. One extra call per
  // symbol would be affordable, but only for the handful the user is actually
  // looking at — so enrichment is capped and best-effort.
  await enrichFromProfiles(found);

  return { quotes: Array.from(found.values()), providers: Array.from(providers) };
}

const ENRICH_LIMIT = 6;

/**
 * Neither Yahoo's chart meta nor Finnhub's quote carries a market cap, so it is
 * backfilled from Finnhub's profile endpoint for the handful of names actually
 * on screen. Capped and best-effort: one extra call per symbol is affordable
 * for six rows and indefensible for forty, and a missing market cap is a dash
 * in a table rather than a broken quote.
 *
 * US only — Finnhub's free profile endpoint does not cover Indian listings.
 */
async function enrichFromProfiles(found: Map<string, Quote>): Promise<void> {
  if (!finnhub.meta.configured) return;

  const needing = Array.from(found.values())
    .filter((q) => q.marketCap == null && q.region === "US" && q.sector !== "Index")
    .slice(0, ENRICH_LIMIT);
  if (needing.length === 0) return;
  if (!canSpend(finnhub.meta.id, needing.length)) return;

  await Promise.all(
    needing.map(async (quote) => {
      try {
        const extras = await finnhub.fetchProfileExtras?.({
          symbol: quote.symbol,
        } as Instrument);
        if (extras?.marketCap != null) {
          found.set(quote.slug, { ...quote, marketCap: extras.marketCap });
        }
      } catch {
        /* cosmetic — never fail a quote over a missing market cap */
      }
    }),
  );
}

/* ── Series ───────────────────────────────────────────────────────────────── */

export async function fetchSeries(
  inst: Instrument,
  range: RangeKey,
): Promise<{ candles: Candle[]; provider: string } | null> {
  const chain = chainFor("series", inst);
  const result = await firstOf<Candle[]>(
    chain,
    1,
    (p) => (p.fetchSeries ? p.fetchSeries(inst, range) : Promise.resolve(null)),
    (v) => v.length === 0,
  );
  return result ? { candles: result.value, provider: result.provider } : null;
}

/* ── Breadth endpoints ────────────────────────────────────────────────────── */

export async function fetchNews(
  inst: Instrument | null,
  limit = 20,
): Promise<{ items: NewsItem[]; provider: string } | null> {
  // General market news has no instrument to route on; Finnhub is the only
  // provider here that serves it.
  const chain = inst ? chainFor("news", inst) : [finnhub].filter(isConfigured);
  const result = await firstOf<NewsItem[]>(
    chain,
    1,
    (p) => (p.fetchNews ? p.fetchNews(inst, limit) : Promise.resolve(null)),
    (v) => v.length === 0,
  );
  return result ? { items: result.value, provider: result.provider } : null;
}

export async function fetchFundamentals(inst: Instrument): Promise<Fundamentals | null> {
  const result = await firstOf<Fundamentals>(
    chainFor("fundamentals", inst),
    1,
    (p) => (p.fetchFundamentals ? p.fetchFundamentals(inst) : Promise.resolve(null)),
    (v) => v.marketCap == null && v.peRatio == null && v.netMargin == null,
  );
  return result?.value ?? null;
}

export async function fetchRecommendations(inst: Instrument): Promise<AnalystConsensus | null> {
  const result = await firstOf<AnalystConsensus>(
    chainFor("recommendations", inst),
    1,
    (p) => (p.fetchRecommendations ? p.fetchRecommendations(inst) : Promise.resolve(null)),
    // A consensus with price targets but no published rating breakdown is
    // still worth showing — insisting on a non-zero count discarded coverage
    // for most Indian listings, where Yahoo reports targets and a mean rating
    // without the strong-buy/buy/hold split.
    (v) => v.total === 0 && v.targetMean == null,
  );
  return result?.value ?? null;
}

export async function fetchEarnings(inst: Instrument): Promise<EarningsPoint[]> {
  const result = await firstOf<EarningsPoint[]>(
    chainFor("earnings", inst),
    1,
    (p) => (p.fetchEarnings ? p.fetchEarnings(inst) : Promise.resolve(null)),
    (v) => v.length === 0,
  );
  return result?.value ?? [];
}

export async function fetchPeers(inst: Instrument): Promise<string[]> {
  const result = await firstOf<string[]>(
    chainFor("peers", inst),
    1,
    (p) => (p.fetchPeers ? p.fetchPeers(inst) : Promise.resolve(null)),
    (v) => v.length === 0,
  );
  return result?.value ?? [];
}

/* ── Introspection ────────────────────────────────────────────────────────── */

export interface ProviderStatusRow {
  id: string;
  label: string;
  homepage: string;
  configured: boolean;
  envVar: string | null;
  capabilities: Capability[];
  coverage: string[];
  budget: { minute: number | null; day: number | null };
}

/** Powers /api/health and the attribution footer. */
export function providerStatus(): ProviderStatusRow[] {
  const budgets = limiterSnapshot();
  return ALL_PROVIDERS.map((p) => ({
    id: p.meta.id,
    label: p.meta.label,
    homepage: p.meta.homepage,
    configured: p.meta.configured,
    envVar: p.meta.envVar,
    capabilities: p.meta.capabilities,
    coverage: p.meta.coverage,
    budget: budgets[p.meta.id] ?? { minute: null, day: null },
  }));
}

export function configuredProviderCount(): number {
  return ALL_PROVIDERS.filter(isConfigured).length;
}

/** True when at least one provider can price this instrument right now. */
export function hasLiveCoverage(inst: Instrument): boolean {
  return chainFor("quote", inst).length > 0;
}
