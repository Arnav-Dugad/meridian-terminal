import type { ExchangeCode, Region } from "@/lib/market/exchanges";
import type { Currency } from "@/lib/format";
import type { Sector } from "@/lib/market/universe";

/**
 * Domain types.
 *
 * Nothing above this layer sees a Twelve Data payload. The vendor returns
 * every numeric field as a string, uses two different envelope shapes
 * depending on whether you asked for one symbol or many, and reports
 * per-symbol failures inside a 200 response. All of that is absorbed by the
 * normalisers so the rest of the app can hold a plain, fully-typed value.
 */

/**
 * Where a figure came from. Surfaced in the UI -- never silently mixed.
 *
 * There is deliberately no "simulated" member. Earlier versions filled gaps
 * with a generated market so the interface always had something to draw; that
 * is a worse failure than an empty panel, because a plausible wrong number is
 * indistinguishable from a right one at a glance. When no provider can answer,
 * the app now says so and shows nothing.
 */
export type DataSource = "live" | "cached";

/**
 * Why an instrument has no data.
 *
 * Carried alongside results so the interface can explain a gap specifically —
 * "the exchange is rate-limiting us" and "this symbol is not covered by your
 * plan" call for completely different responses from the reader.
 */
export interface DataFailure {
  slug: string;
  symbol: string;
  reason: string;
  /** True when retrying shortly is likely to succeed. */
  transient: boolean;
}

export interface Quote {
  symbol: string;
  slug: string;
  name: string;
  exchange: ExchangeCode;
  region: Region;
  currency: Currency;
  sector: Sector;

  price: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  change: number;
  changePercent: number;
  volume: number;

  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Position in the 52-week band, 0 (at low) to 1 (at high). */
  fiftyTwoWeekPosition: number | null;
  marketCap: number | null;

  /** Epoch milliseconds of the last print. */
  timestamp: number;
  isOpen: boolean;
  source: DataSource;
  /**
   * Which upstream produced this figure (`finnhub`, `coingecko`, …). Carried
   * so the interface can attribute a number to its source, and so the registry
   * knows which quotes still need enriching with fields that provider omits.
   */
  provider?: string;
}

export interface Candle {
  /** Epoch milliseconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Interval = "1min" | "5min" | "15min" | "30min" | "1h" | "1day" | "1week" | "1month";

/** Presentation ranges the UI offers, mapped to an interval + bar count. */
export type RangeKey = "1D" | "1W" | "1M" | "6M" | "1Y" | "5Y" | "MAX";

export const RANGE_SPEC: Record<RangeKey, { interval: Interval; outputsize: number; label: string }> = {
  "1D": { interval: "5min", outputsize: 78, label: "1 day" },
  "1W": { interval: "30min", outputsize: 70, label: "1 week" },
  "1M": { interval: "1h", outputsize: 160, label: "1 month" },
  "6M": { interval: "1day", outputsize: 130, label: "6 months" },
  "1Y": { interval: "1day", outputsize: 260, label: "1 year" },
  "5Y": { interval: "1week", outputsize: 260, label: "5 years" },
  MAX: { interval: "1month", outputsize: 300, label: "Max" },
};

export const RANGE_KEYS: RangeKey[] = ["1D", "1W", "1M", "6M", "1Y", "5Y", "MAX"];

export interface Series {
  symbol: string;
  slug: string;
  interval: Interval;
  range: RangeKey;
  currency: Currency;
  /** Oldest first. Every consumer assumes ascending time. */
  candles: Candle[];
  source: DataSource;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: ExchangeCode;
  currency: Currency;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  employees: number | null;
  ceo: string | null;
  country: string | null;
  source: DataSource;
}

export interface FxRate {
  pair: string;
  rate: number;
  timestamp: number;
  source: DataSource;
}

export interface MarketBreadth {
  region: Region;
  advancing: number;
  declining: number;
  unchanged: number;
  /** Cap-weighted mean change, in percent. */
  weightedChange: number;
  /** Simple mean change, in percent. */
  meanChange: number;
  /** Advancing share, 0 to 1. */
  ratio: number;
}

export interface SectorAggregate {
  sector: Sector;
  region: Region;
  changePercent: number;
  weight: number;
  count: number;
  advancing: number;
  leaders: { slug: string; symbol: string; changePercent: number }[];
}

/** Envelope every route handler returns, so the client always knows provenance. */
export interface ApiEnvelope<T> {
  data: T;
  source: DataSource;
  /** Epoch ms this payload was assembled. */
  asOf: number;
  /** Set when the live provider was unavailable and we degraded. */
  notice?: string;
  /** Upstream ids that contributed, for attribution and debugging. */
  providers?: string[];
}

export class TwelveDataError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "TwelveDataError";
  }

  /** Rate limits and gateway hiccups are worth retrying; 404s are not. */
  get retryable() {
    return this.code === 429 || this.code >= 500;
  }
}
