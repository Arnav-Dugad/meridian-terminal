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

/**
 * Flow alerts watch the Indian institutional tape rather than a price.
 *
 * These are separate from price alerts because they have no instrument — the
 * subject is the market's foreign or domestic institutional activity as a
 * whole, published once per session. Nothing else consumer-facing offers this.
 */
export type FlowAlertKind =
  | "fii-buy-above"
  | "fii-sell-above"
  | "dii-buy-above"
  | "dii-sell-above"
  | "combined-buy-above"
  | "combined-sell-above"
  /** Any single disclosed bulk or block trade above the threshold. */
  | "deal-buy-above"
  | "deal-sell-above";

export interface FlowAlert {
  id: string;
  kind: FlowAlertKind;
  /** Threshold in crore rupees, always positive. */
  threshold: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
  /** The date of the session that tripped it, so it can re-arm the next day. */
  triggeredForDate?: string;
  note?: string;
}

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

export type ThemePreference = "dark" | "light" | "system";
export type Density = "comfortable" | "compact";

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

  /** Synced across devices; localStorage holds a copy for the no-flash boot. */
  theme: ThemePreference;
  /** Row heights and gutters throughout. */
  density: Density;
  /** Which market the terminal opens on. */
  homeRegion: "IN" | "US" | "GLOBAL";
  /** The scrolling price tape along the bottom. */
  showTape: boolean;
  /** Flash cells green/red as prices tick. */
  flashTicks: boolean;
  /** Annual rate used by Sharpe, Sortino and the backtester, as a percentage. */
  riskFreeRate: number;
  /** Per-side trading cost assumed by the backtester, in basis points. */
  backtestCostBps: number;
  /** Ask the browser to raise a notification when an alert fires. */
  desktopNotifications: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  baseCurrency: "INR",
  defaultRange: "6M",
  chartStyle: "area",
  indicators: ["ema20", "ema50"],
  reducedMotion: false,
  theme: "dark",
  density: "comfortable",
  homeRegion: "IN",
  showTape: true,
  flashTicks: true,
  riskFreeRate: 6.5,
  backtestCostBps: 5,
  desktopNotifications: false,
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

/** One tile in the workspace grid. */
export interface WorkspacePane {
  slug: string;
  range: RangeKey;
  style: "candles" | "area";
}

/**
 * A saved arrangement of up to four instruments.
 *
 * The point of a workspace is that it is *the same* every time you open it —
 * so it stores the exact panes, not a query that might resolve differently.
 */
export interface Workspace {
  id: string;
  name: string;
  panes: WorkspacePane[];
  createdAt: number;
  updatedAt: number;
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
  workspaces: Workspace[];
  flowAlerts: FlowAlert[];
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
  workspaces: [],
  flowAlerts: [],
};

/** Caps, enforced on write so a document cannot grow without bound. */
export const LIMITS = {
  recentlyViewed: 24,
  notes: 200,
  savedScreens: 30,
  /** Roughly two years of daily points. */
  snapshots: 730,
  workspaces: 12,
  /** Panes per workspace — the grid is 2×2. */
  panes: 4,
  flowAlerts: 20,
} as const;

/** Where the current personal data is being persisted. */
export type StorageMode = "cloud" | "local";
