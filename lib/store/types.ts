import type { Currency } from "@/lib/format";
import type { RangeKey } from "@/lib/twelvedata/types";

/** A held position. `avgPrice` is in the instrument's own currency. */
export interface Position {
  id: string;
  slug: string;
  symbol: string;
  name: string;
  currency: Currency;
  quantity: number;
  avgPrice: number;
  openedAt: number;
  note?: string;
}

export type AlertKind = "above" | "below" | "pct-gain" | "pct-loss";

export interface PriceAlert {
  id: string;
  slug: string;
  symbol: string;
  name: string;
  currency: Currency;
  kind: AlertKind;
  /** Price level for above/below; percentage points for the pct kinds. */
  threshold: number;
  /** Reference price captured at creation, used by the percentage kinds. */
  basePrice: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
  note?: string;
}

export interface Preferences {
  /** Currency the portfolio is totalled in. */
  baseCurrency: Currency;
  defaultRange: RangeKey;
  /** Candlesticks or the line/area rendering. */
  chartStyle: "candles" | "area";
  /** Indicator ids currently pinned to the chart. */
  indicators: string[];
  /** Dim the interface's motion without touching the OS setting. */
  reducedMotion: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  baseCurrency: "INR",
  defaultRange: "6M",
  chartStyle: "area",
  indicators: ["ema20", "ema50"],
  reducedMotion: false,
};

export interface PersonalState {
  watchlist: string[];
  positions: Position[];
  alerts: PriceAlert[];
  preferences: Preferences;
}

export const EMPTY_PERSONAL: PersonalState = {
  watchlist: [],
  positions: [],
  alerts: [],
  preferences: DEFAULT_PREFERENCES,
};

/** Where the current personal data is being persisted. */
export type StorageMode = "cloud" | "local";
