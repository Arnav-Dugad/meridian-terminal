import type { Candle, Quote, RangeKey } from "@/lib/twelvedata/types";
import type { Instrument } from "@/lib/market/universe";

/**
 * The provider contract.
 *
 * Every upstream — Finnhub, Twelve Data, FMP, CoinGecko, Alpha Vantage —
 * implements the subset of these capabilities it actually covers, and the
 * registry composes them. Nothing above this layer knows which service a
 * number came from, only its provenance class (live / cached / simulated) and,
 * for display, the provider's name.
 *
 * Capabilities are declared rather than inferred so the registry can route
 * without trial requests: asking Finnhub for an NSE quote and waiting for the
 * 403 would cost a call from a budget of sixty.
 */

export type Capability =
  | "quote"
  | "series"
  | "profile"
  | "news"
  | "fundamentals"
  | "recommendations"
  | "earnings"
  | "peers"
  | "fx";

export type AssetClass = "equity" | "index" | "crypto";
export type Coverage = "US" | "IN" | "CRYPTO" | "FX";

export interface NewsItem {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  url: string;
  publishedAt: number;
  /** Symbols the item is tagged with, when the provider says. */
  symbols: string[];
  imageUrl: string | null;
  category: string | null;
}

export interface Fundamentals {
  symbol: string;
  marketCap: number | null;
  peRatio: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  eps: number | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  dividendYield: number | null;
  beta: number | null;
  sharesOutstanding: number | null;
  /** ISO date of the fiscal period these figures describe. */
  asOf: string | null;
  provider: string;
}

export interface AnalystConsensus {
  symbol: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  /** 1 (strong buy) to 5 (strong sell). */
  score: number;
  total: number;
  period: string | null;
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  provider: string;
}

export interface EarningsPoint {
  period: string;
  reportedAt: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  /** Percentage beat or miss against estimate. */
  surprisePercent: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
}

export interface ProviderMeta {
  id: string;
  label: string;
  /** Marketing URL, shown in the attribution footer. */
  homepage: string;
  capabilities: Capability[];
  coverage: Coverage[];
  /** Set when the required environment variable is present. */
  configured: boolean;
  envVar: string | null;
}

export interface InsiderTradeShape {
  name: string;
  shares: number;
  direction: "buy" | "sell";
  openMarket: boolean;
  code: string | null;
  price: number | null;
  value: number | null;
  filedAt: number | null;
  transactedAt: number | null;
}

export interface QuoteProvider {
  readonly meta: ProviderMeta;
  fetchQuotes?(instruments: Instrument[]): Promise<Quote[]>;
  fetchInsiderTransactions?(instrument: Instrument): Promise<InsiderTradeShape[]>;
  fetchSeries?(instrument: Instrument, range: RangeKey): Promise<Candle[]>;
  fetchProfileExtras?(instrument: Instrument): Promise<Partial<Fundamentals> | null>;
  fetchNews?(instrument: Instrument | null, limit: number): Promise<NewsItem[]>;
  fetchFundamentals?(instrument: Instrument): Promise<Fundamentals | null>;
  fetchRecommendations?(instrument: Instrument): Promise<AnalystConsensus | null>;
  fetchEarnings?(instrument: Instrument): Promise<EarningsPoint[]>;
  fetchPeers?(instrument: Instrument): Promise<string[]>;
}

/** Thrown by providers so the registry can distinguish "skip" from "broken". */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number,
    /** True when trying the next provider is worthwhile. */
    readonly failover = true,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}
