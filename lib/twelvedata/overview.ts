import "server-only";

import {
  computeBreadth,
  computeSectors,
  getFx,
  getNews,
  getQuotes,
  marketStatusSnapshot,
} from "@/lib/twelvedata/service";
import type { NewsItem } from "@/lib/providers/types";
import type { DataSource, FxRate, MarketBreadth, Quote, SectorAggregate } from "@/lib/twelvedata/types";
import { CRYPTO, EQUITIES, INDICES } from "@/lib/market/universe";

/**
 * The dashboard snapshot, assembled once.
 *
 * Shared by `/api/overview` and the server-rendered dashboard, so both read
 * from one definition. Assembling server-side matters for more than latency:
 * breadth, sector rotation and the movers list are all derived from the *same*
 * set of quotes, so the panels agree with each other. Six independent client
 * fetches would produce figures captured seconds apart that quietly disagree.
 */

export interface OverviewPayload {
  indices: Quote[];
  crypto: Quote[];
  movers: { gainers: Quote[]; losers: Quote[]; active: Quote[] };
  breadth: { IN: MarketBreadth; US: MarketBreadth };
  sectors: { IN: SectorAggregate[]; US: SectorAggregate[] };
  fx: FxRate;
  news: NewsItem[];
  sessions: ReturnType<typeof marketStatusSnapshot>;
  asOf: number;
  source: DataSource;
  notice?: string;
  providers: string[];
}

/**
 * Names priced per region for the breadth and rotation panels.
 *
 * Now that US quotes route through Finnhub's 60/min budget rather than
 * competing with India for Twelve Data's eight, the US sample can be far
 * wider than the Indian one without starving anything.
 */
const US_SAMPLE = 40;
const IN_SAMPLE = 20;
const CRYPTO_SAMPLE = 12;

/** Rough INR-per-USD, used only to rank the two regions on one scale. */
const RANKING_FX = 88;

export async function getOverview(): Promise<OverviewPayload> {
  const usSlugs = EQUITIES.filter((i) => i.region === "US")
    .sort((a, b) => b.seedCap - a.seedCap)
    .slice(0, US_SAMPLE)
    .map((i) => i.slug);

  const inSlugs = EQUITIES.filter((i) => i.region === "IN")
    .sort((a, b) => b.seedCap - a.seedCap)
    .slice(0, IN_SAMPLE)
    .map((i) => i.slug);

  const cryptoSlugs = CRYPTO.slice(0, CRYPTO_SAMPLE).map((i) => i.slug);

  // Independent budgets, so these genuinely run in parallel rather than
  // queueing behind one another on a shared limiter.
  const [indexRes, usRes, inRes, cryptoRes, fxRes, newsRes] = await Promise.all([
    getQuotes(INDICES.map((i) => i.slug)),
    getQuotes(usSlugs),
    getQuotes(inSlugs),
    getQuotes(cryptoSlugs),
    getFx("USD/INR"),
    getNews(null, 8),
  ]);

  const equities = [...usRes.data, ...inRes.data];
  const ranked = equities.slice().sort((a, b) => b.changePercent - a.changePercent);

  // Turnover has to be compared in one currency, or every US name outranks
  // every Indian one purely on the exchange rate.
  const byTurnover = equities
    .slice()
    .sort((a, b) => turnoverUsd(b) - turnoverUsd(a))
    .slice(0, 8);

  const sources: DataSource[] = [indexRes.source, usRes.source, inRes.source];
  const source: DataSource = sources.every((s) => s === "live")
    ? "live"
    : sources.some((s) => s === "live" || s === "cached")
      ? "cached"
      : "simulated";

  const providers = Array.from(
    new Set([
      ...(indexRes.providers ?? []),
      ...(usRes.providers ?? []),
      ...(inRes.providers ?? []),
      ...(cryptoRes.providers ?? []),
      ...(newsRes.providers ?? []),
    ]),
  );

  return {
    indices: indexRes.data,
    crypto: cryptoRes.data,
    movers: {
      gainers: ranked.slice(0, 8),
      losers: ranked.slice(-8).reverse(),
      active: byTurnover,
    },
    breadth: {
      IN: computeBreadth(equities, "IN"),
      US: computeBreadth(equities, "US"),
    },
    sectors: {
      IN: computeSectors(equities, "IN"),
      US: computeSectors(equities, "US"),
    },
    fx: fxRes.data,
    news: newsRes.data,
    sessions: marketStatusSnapshot(),
    asOf: Date.now(),
    source,
    // Surface the most specific complaint available — the India-specific
    // message is far more actionable than a generic one.
    notice: inRes.notice ?? usRes.notice ?? indexRes.notice,
    providers,
  };
}

function turnoverUsd(q: Quote): number {
  const native = q.volume * q.price;
  return q.currency === "INR" ? native / RANKING_FX : native;
}
