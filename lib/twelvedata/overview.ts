import "server-only";

import { computeBreadth, computeSectors, getFx, getQuotes, marketStatusSnapshot } from "@/lib/twelvedata/service";
import type { DataSource, FxRate, MarketBreadth, Quote, SectorAggregate } from "@/lib/twelvedata/types";
import { EQUITIES, INDICES } from "@/lib/market/universe";

/**
 * The dashboard snapshot, assembled once.
 *
 * Shared by the `/api/overview` route and the server-rendered dashboard, so
 * both read from a single definition. Assembling server-side matters for more
 * than latency: breadth, sector rotation and the movers list are all derived
 * from the *same* set of quotes, so the numbers agree with each other. Six
 * independent client fetches would produce panels captured seconds apart that
 * quietly disagree.
 */

export interface OverviewPayload {
  indices: Quote[];
  movers: { gainers: Quote[]; losers: Quote[]; active: Quote[] };
  breadth: { IN: MarketBreadth; US: MarketBreadth };
  sectors: { IN: SectorAggregate[]; US: SectorAggregate[] };
  fx: FxRate;
  sessions: ReturnType<typeof marketStatusSnapshot>;
  asOf: number;
  source: DataSource;
  notice?: string;
}

/**
 * Names priced per region for the breadth and rotation panels.
 *
 * The full universe is ~130 symbols, far beyond a free-tier minute, so we take
 * the largest names per region. Raise this on a paid plan — it is the single
 * knob that trades credits for breadth resolution.
 */
const BREADTH_SAMPLE_PER_REGION = 24;

/** Rough INR-per-USD used only to rank the two regions on one scale. */
const RANKING_FX = 88;

export async function getOverview(): Promise<OverviewPayload> {
  const sample = [
    ...EQUITIES.filter((i) => i.region === "IN")
      .sort((a, b) => b.seedCap - a.seedCap)
      .slice(0, BREADTH_SAMPLE_PER_REGION),
    ...EQUITIES.filter((i) => i.region === "US")
      .sort((a, b) => b.seedCap - a.seedCap)
      .slice(0, BREADTH_SAMPLE_PER_REGION),
  ].map((i) => i.slug);

  const [indexRes, equityRes, fxRes] = await Promise.all([
    getQuotes(INDICES.map((i) => i.slug)),
    getQuotes(sample),
    getFx("USD/INR"),
  ]);

  const equities = equityRes.data;
  const ranked = equities.slice().sort((a, b) => b.changePercent - a.changePercent);

  // Turnover has to be compared in one currency or every US name outranks
  // every Indian one purely on the exchange rate.
  const byTurnover = equities
    .slice()
    .sort((a, b) => turnoverUsd(b) - turnoverUsd(a))
    .slice(0, 8);

  const sources: DataSource[] = [indexRes.source, equityRes.source, fxRes.source];
  const source: DataSource = sources.every((s) => s === "live")
    ? "live"
    : sources.some((s) => s === "live" || s === "cached")
      ? "cached"
      : "simulated";

  return {
    indices: indexRes.data,
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
    sessions: marketStatusSnapshot(),
    asOf: Date.now(),
    source,
    notice: indexRes.notice ?? equityRes.notice,
  };
}

function turnoverUsd(q: Quote): number {
  const native = q.volume * q.price;
  return q.currency === "INR" ? native / RANKING_FX : native;
}
