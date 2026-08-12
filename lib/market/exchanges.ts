import type { Currency } from "@/lib/format";

/**
 * Exchange metadata and session arithmetic.
 *
 * Market state is derived locally rather than fetched. Twelve Data does expose
 * /market_state, but spending an API credit every few seconds to learn
 * something that is a pure function of the wall clock is wasteful, and the
 * answer has to be correct on the client anyway for the session countdown to
 * tick smoothly.
 */

export type ExchangeCode = "NSE" | "BSE" | "NASDAQ" | "NYSE";
export type Region = "IN" | "US";

export interface ExchangeMeta {
  code: ExchangeCode;
  name: string;
  region: Region;
  country: string;
  currency: Currency;
  timezone: string;
  /** Minutes from local midnight. */
  preOpen: number | null;
  open: number;
  close: number;
  postClose: number | null;
  /** ISO weekday numbers (1 = Monday) on which the exchange trades. */
  tradingDays: number[];
  flagAccent: string;
}

export const EXCHANGES: Record<ExchangeCode, ExchangeMeta> = {
  NSE: {
    code: "NSE",
    name: "National Stock Exchange of India",
    region: "IN",
    country: "India",
    currency: "INR",
    timezone: "Asia/Kolkata",
    preOpen: 9 * 60,
    open: 9 * 60 + 15,
    close: 15 * 60 + 30,
    postClose: 16 * 60,
    tradingDays: [1, 2, 3, 4, 5],
    flagAccent: "#f0a63c",
  },
  BSE: {
    code: "BSE",
    name: "BSE Limited",
    region: "IN",
    country: "India",
    currency: "INR",
    timezone: "Asia/Kolkata",
    preOpen: 9 * 60,
    open: 9 * 60 + 15,
    close: 15 * 60 + 30,
    postClose: 16 * 60,
    tradingDays: [1, 2, 3, 4, 5],
    flagAccent: "#f0a63c",
  },
  NASDAQ: {
    code: "NASDAQ",
    name: "Nasdaq Stock Market",
    region: "US",
    country: "United States",
    currency: "USD",
    timezone: "America/New_York",
    preOpen: 4 * 60,
    open: 9 * 60 + 30,
    close: 16 * 60,
    postClose: 20 * 60,
    tradingDays: [1, 2, 3, 4, 5],
    flagAccent: "#7ba7f0",
  },
  NYSE: {
    code: "NYSE",
    name: "New York Stock Exchange",
    region: "US",
    country: "United States",
    currency: "USD",
    timezone: "America/New_York",
    preOpen: 4 * 60,
    open: 9 * 60 + 30,
    close: 16 * 60,
    postClose: 20 * 60,
    tradingDays: [1, 2, 3, 4, 5],
    flagAccent: "#7ba7f0",
  },
};

export const REGION_LABEL: Record<Region, string> = { IN: "India", US: "United States" };
export const REGION_ACCENT: Record<Region, string> = { IN: "#f0a63c", US: "#7ba7f0" };

export function currencyForExchange(code: ExchangeCode): Currency {
  return EXCHANGES[code].currency;
}

export function regionForExchange(code: ExchangeCode): Region {
  return EXCHANGES[code].region;
}

export type SessionPhase = "pre" | "open" | "post" | "closed" | "weekend";

export interface SessionState {
  phase: SessionPhase;
  label: string;
  /** True only during the continuous regular session. */
  isLive: boolean;
  /** Local exchange time, minutes past midnight. */
  localMinutes: number;
  localTime: string;
  /** Seconds until the next phase boundary; null across a weekend gap. */
  secondsToNextBoundary: number | null;
  nextBoundaryLabel: string;
  /** 0 → session start, 1 → session end. Clamped. */
  sessionProgress: number;
}

interface ZonedParts {
  minutes: number;
  weekday: number;
  seconds: number;
  hh: string;
  mm: string;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function zonedParts(now: Date, tz: string): ZonedParts {
  const parts = zonedFormatter(tz).formatToParts(now);
  let hh = "00";
  let mm = "00";
  let ss = "00";
  let wd = "Mon";
  for (const p of parts) {
    if (p.type === "hour") hh = p.value;
    else if (p.type === "minute") mm = p.value;
    else if (p.type === "second") ss = p.value;
    else if (p.type === "weekday") wd = p.value;
  }
  // en-GB renders midnight as "24" in some ICU builds.
  const hours = Number(hh) % 24;
  return {
    minutes: hours * 60 + Number(mm),
    seconds: Number(ss),
    weekday: WEEKDAY_INDEX[wd] ?? 1,
    hh: String(hours).padStart(2, "0"),
    mm,
  };
}

export function sessionState(code: ExchangeCode, now: Date = new Date()): SessionState {
  const ex = EXCHANGES[code];
  const { minutes, seconds, weekday, hh, mm } = zonedParts(now, ex.timezone);
  const localTime = `${hh}:${mm}`;
  const secsIntoMinute = seconds;

  const base = {
    localMinutes: minutes,
    localTime,
    sessionProgress: clamp01((minutes - ex.open) / (ex.close - ex.open)),
  };

  if (!ex.tradingDays.includes(weekday)) {
    return {
      ...base,
      phase: "weekend",
      label: "Weekend",
      isLive: false,
      secondsToNextBoundary: null,
      nextBoundaryLabel: "Opens Monday",
      sessionProgress: 0,
    };
  }

  const toBoundary = (boundaryMinutes: number) =>
    (boundaryMinutes - minutes) * 60 - secsIntoMinute;

  if (ex.preOpen != null && minutes >= ex.preOpen && minutes < ex.open) {
    return {
      ...base,
      phase: "pre",
      label: "Pre-market",
      isLive: false,
      secondsToNextBoundary: toBoundary(ex.open),
      nextBoundaryLabel: "Opens in",
      sessionProgress: 0,
    };
  }

  if (minutes >= ex.open && minutes < ex.close) {
    return {
      ...base,
      phase: "open",
      label: "Open",
      isLive: true,
      secondsToNextBoundary: toBoundary(ex.close),
      nextBoundaryLabel: "Closes in",
    };
  }

  if (ex.postClose != null && minutes >= ex.close && minutes < ex.postClose) {
    return {
      ...base,
      phase: "post",
      label: "Post-market",
      isLive: false,
      secondsToNextBoundary: toBoundary(ex.postClose),
      nextBoundaryLabel: "Session ends in",
      sessionProgress: 1,
    };
  }

  // Closed. Next open is today if we are before pre-open, else tomorrow.
  const nextOpenMinutes = ex.preOpen ?? ex.open;
  const beforeToday = minutes < nextOpenMinutes;
  const isFridayEvening = weekday === 5 && !beforeToday;
  return {
    ...base,
    phase: "closed",
    label: "Closed",
    isLive: false,
    secondsToNextBoundary: beforeToday ? toBoundary(nextOpenMinutes) : null,
    nextBoundaryLabel: beforeToday ? "Opens in" : isFridayEvening ? "Opens Monday" : "Opens tomorrow",
    sessionProgress: minutes >= ex.close ? 1 : 0,
  };
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** `2h 14m` / `48m 12s` / `31s` */
export function formatCountdown(totalSeconds: number | null): string {
  if (totalSeconds == null || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export const PHASE_TONE: Record<SessionPhase, { dot: string; text: string }> = {
  open: { dot: "bg-up", text: "text-up" },
  pre: { dot: "bg-signal", text: "text-signal" },
  post: { dot: "bg-usa", text: "text-usa" },
  closed: { dot: "bg-ivory-40", text: "text-ivory-60" },
  weekend: { dot: "bg-ivory-40", text: "text-ivory-60" },
};
