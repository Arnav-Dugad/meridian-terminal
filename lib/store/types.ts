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

/** A research note pinned to an instrument. */
export interface InstrumentNote {
  slug: string;
  symbol: string;
  body: string;
  updatedAt: number;
}

/** A saved screener configuration. */
export interface SavedScreen {
  id: string;
  name: string;
  regions: string[];
  sectors: string[];
  changeFilter: string;
  rangeFilter: string;
  minChange: number;
  createdAt: number;
}

/**
 * A day's closing valuation of the book.
 *
 * Portfolio value is otherwise a number with no history — you can see what you
 * hold today but not whether it is working. One small document per day turns
 * that into a performance curve, and because it is keyed by date it is
 * idempotent: writing twice on the same day overwrites rather than duplicates.
 */
export interface PortfolioSnapshot {
  /** `YYYY-MM-DD` in the user's own timezone — also the document id. */
  date: string;
  /** Total market value, in the base currency at the time. */
  value: number;
  cost: number;
  pnl: number;
  baseCurrency: Currency;
  positionCount: number;
  /** USD/INR at the time, so a past value can be re-expressed later. */
  fxRate: number;
  recordedAt: number;
}

export interface PersonalState {
  watchlist: string[];
  positions: Position[];
  alerts: PriceAlert[];
  preferences: Preferences;
  /** Most-recent-first, capped. Powers the palette's empty state. */
  recentlyViewed: string[];
  notes: InstrumentNote[];
  savedScreens: SavedScreen[];
  snapshots: PortfolioSnapshot[];
}

export const EMPTY_PERSONAL: PersonalState = {
  watchlist: [],
  positions: [],
  alerts: [],
  preferences: DEFAULT_PREFERENCES,
  recentlyViewed: [],
  notes: [],
  savedScreens: [],
  snapshots: [],
};

/** Caps, enforced on write so a document cannot grow without bound. */
export const LIMITS = {
  recentlyViewed: 24,
  notes: 200,
  savedScreens: 30,
  /** Roughly two years of daily points. */
  snapshots: 730,
} as const;

/** Where the current personal data is being persisted. */
export type StorageMode = "cloud" | "local";
