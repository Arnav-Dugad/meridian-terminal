/**
 * Number and date presentation.
 *
 * The Indian and Western numbering systems disagree past four digits, and a
 * product that serves both markets has to respect that. A market cap shown to
 * an NSE trader belongs in crore with 2,32,10,000-style grouping; the same
 * figure shown against a NASDAQ listing belongs in billions. Everything here
 * takes an explicit currency so the call site can never get it wrong by
 * accident.
 */

/**
 * Currencies the terminal can display.
 *
 * INR and USD are the two the portfolio totals in; EUR and GBP exist because
 * several of the globally-diversified funds are denominated in them, and
 * labelling a euro price as dollars to avoid widening this union would be a
 * lie for the sake of a type.
 */
export type Currency = "INR" | "USD" | "EUR" | "GBP";

/** The two a portfolio can be totalled in, which requires an FX rate we have. */
export type BaseCurrency = "INR" | "USD";

const LAKH = 1e5;
const CRORE = 1e7;

const nf = (locale: string, opts: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale, opts);

/** Cache formatters — constructing Intl.NumberFormat is genuinely expensive. */
const formatterCache = new Map<string, Intl.NumberFormat>();
function getFormatter(locale: string, opts: Intl.NumberFormatOptions) {
  const key = locale + JSON.stringify(opts);
  let f = formatterCache.get(key);
  if (!f) {
    f = nf(locale, opts);
    formatterCache.set(key, f);
  }
  return f;
}

const LOCALES: Record<Currency, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
};

const SYMBOLS: Record<Currency, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function localeFor(currency: Currency) {
  return LOCALES[currency] ?? "en-US";
}

export function symbolFor(currency: Currency) {
  return SYMBOLS[currency] ?? "$";
}

/** Only the Indian system groups in lakh and crore. */
function usesIndianScale(currency: Currency) {
  return currency === "INR";
}

/**
 * A price. Equities get 2 decimals; sub-rupee and penny instruments get more
 * so the tick is still visible.
 */
export function formatPrice(
  value: number | null | undefined,
  currency: Currency = "USD",
  opts: { withSymbol?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const body = getFormatter(localeFor(currency), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return opts.withSymbol === false ? body : symbolFor(currency) + body;
}

/**
 * Large money, abbreviated in the reader's own system.
 *   INR → ₹1.24 L / ₹18.4 Cr / ₹4.02 L Cr
 *   USD → $1.24M / $18.4B / $4.02T
 */
export function formatCompactMoney(
  value: number | null | undefined,
  currency: Currency = "USD",
): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  const sym = symbolFor(currency);

  if (usesIndianScale(currency)) {
    if (v >= 1e5 * CRORE) return `${sign}${sym}${trim(v / (1e5 * CRORE))} L Cr`;
    if (v >= CRORE) return `${sign}${sym}${trim(v / CRORE)} Cr`;
    if (v >= LAKH) return `${sign}${sym}${trim(v / LAKH)} L`;
    if (v >= 1000) return `${sign}${sym}${trim(v / 1000)} K`;
    return `${sign}${sym}${trim(v)}`;
  }

  if (v >= 1e12) return `${sign}${sym}${trim(v / 1e12)}T`;
  if (v >= 1e9) return `${sign}${sym}${trim(v / 1e9)}B`;
  if (v >= 1e6) return `${sign}${sym}${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${sign}${sym}${trim(v / 1e3)}K`;
  return `${sign}${sym}${trim(v)}`;
}

/** Bare compact count — share volume, employee headcount. */
export function formatCompact(value: number | null | undefined, currency: Currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (usesIndianScale(currency)) {
    if (v >= CRORE) return `${sign}${trim(v / CRORE)} Cr`;
    if (v >= LAKH) return `${sign}${trim(v / LAKH)} L`;
    if (v >= 1000) return `${sign}${trim(v / 1000)} K`;
    return `${sign}${trim(v)}`;
  }
  if (v >= 1e12) return `${sign}${trim(v / 1e12)}T`;
  if (v >= 1e9) return `${sign}${trim(v / 1e9)}B`;
  if (v >= 1e6) return `${sign}${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${sign}${trim(v / 1e3)}K`;
  return `${sign}${trim(v)}`;
}

/** Two significant-ish digits, trailing zeros removed. */
function trim(n: number): string {
  const d = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return n.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Signed percentage. `+1.24%` / `-0.30%` */
export function formatPercent(
  value: number | null | undefined,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { decimals = 2, signed = true } = opts;
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatSigned(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

/** Plain grouped integer/decimal in the market's own grouping convention. */
export function formatNumber(
  value: number | null | undefined,
  currency: Currency = "USD",
  decimals = 0,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return getFormatter(localeFor(currency), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export type Direction = "up" | "down" | "flat";

export function directionOf(change: number | null | undefined, epsilon = 1e-9): Direction {
  if (change == null || !Number.isFinite(change) || Math.abs(change) < epsilon) return "flat";
  return change > 0 ? "up" : "down";
}

/** Tailwind text class for a direction. Centralised so red/green never drifts. */
export function directionClass(d: Direction | number | null | undefined): string {
  const dir = typeof d === "number" || d == null ? directionOf(d as number) : d;
  return dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ivory-60";
}

export function directionColor(d: Direction | number | null | undefined): string {
  const dir = typeof d === "number" || d == null ? directionOf(d as number) : d;
  return dir === "up" ? "#3fbf7f" : dir === "down" ? "#f0563f" : "#7c7a74";
}

/* ── Dates ────────────────────────────────────────────────────────────────── */

export function formatDate(d: Date | string | number, tz?: string): string {
  const date = toDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: tz,
  }).format(date);
}

export function formatDateShort(d: Date | string | number, tz?: string): string {
  const date = toDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: tz }).format(date);
}

export function formatTime(d: Date | string | number, tz?: string): string {
  const date = toDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(date);
}

export function formatClock(d: Date | string | number, tz?: string): string {
  const date = toDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(date);
}

export function formatRelative(d: Date | string | number): string {
  const date = toDate(d);
  if (!date) return "—";
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

function toDate(d: Date | string | number): Date | null {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Ordinal-free ISO day key, `2026-08-12`, in a given timezone. */
export function dayKey(d: Date, tz = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
  return parts;
}
