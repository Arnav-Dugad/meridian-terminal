import type { Currency } from "@/lib/format";
import type { Position } from "@/lib/store/types";
import type { Quote } from "@/lib/twelvedata/types";
import type { Region } from "@/lib/market/exchanges";
import type { Sector } from "@/lib/market/universe";

/**
 * Portfolio arithmetic.
 *
 * The interesting problem here is currency. A book holding both RELIANCE and
 * NVDA has two units of account, and every total has to pick one. Rather than
 * converting on the way in — which would silently freeze a rate into stored
 * data — positions keep their native cost basis and conversion happens at read
 * time against the live rate. That means the reported total moves with the
 * rupee, which is correct: an Indian investor holding US equity genuinely is
 * exposed to USD/INR, and hiding that would be a lie of omission.
 *
 * `fxUsdInr` is rupees per dollar.
 */

export interface PositionValuation {
  position: Position;
  quote: Quote | undefined;

  /** Figures in the position's own currency. */
  costNative: number;
  valueNative: number;
  pnlNative: number;
  dayPnlNative: number;

  /** The same figures in the base currency. */
  cost: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;

  /** Share of total portfolio value, 0 to 1. */
  weight: number;
  region: Region;
  sector: Sector;
}

export interface PortfolioSummary {
  positions: PositionValuation[];
  cost: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  baseCurrency: Currency;

  /** Value split by region and by sector, in base currency. */
  byRegion: { region: Region; value: number; share: number; pnl: number }[];
  bySector: { sector: Sector; value: number; share: number; pnl: number }[];

  /** Names moving the book most today, in base currency. */
  contributors: { position: Position; dayPnl: number }[];
  detractors: { position: Position; dayPnl: number }[];

  /** Share of value not denominated in the base currency, 0 to 1. */
  fxExposure: number;
  pricedCount: number;
}

export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  fxUsdInr: number,
): number {
  if (from === to) return amount;
  if (!Number.isFinite(fxUsdInr) || fxUsdInr <= 0) return amount;
  return from === "USD" ? amount * fxUsdInr : amount / fxUsdInr;
}

export function valuePortfolio(
  positions: Position[],
  quotes: Map<string, Quote>,
  baseCurrency: Currency,
  fxUsdInr: number,
): PortfolioSummary {
  const rows: PositionValuation[] = positions.map((position) => {
    const quote = quotes.get(position.slug);
    const native = position.currency;

    const costNative = position.quantity * position.avgPrice;
    const price = quote?.price ?? position.avgPrice;
    const valueNative = position.quantity * price;
    const pnlNative = valueNative - costNative;

    // Day P&L uses the previous close, so it measures today's move rather
    // than lifetime gain.
    const prevClose = quote?.previousClose ?? price;
    const dayPnlNative = position.quantity * (price - prevClose);

    const cost = convert(costNative, native, baseCurrency, fxUsdInr);
    const value = convert(valueNative, native, baseCurrency, fxUsdInr);
    const pnl = convert(pnlNative, native, baseCurrency, fxUsdInr);
    const dayPnl = convert(dayPnlNative, native, baseCurrency, fxUsdInr);

    return {
      position,
      quote,
      costNative,
      valueNative,
      pnlNative,
      dayPnlNative,
      cost,
      value,
      pnl,
      pnlPercent: costNative > 0 ? (pnlNative / costNative) * 100 : 0,
      dayPnl,
      dayPnlPercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      weight: 0,
      region: quote?.region ?? (native === "INR" ? "IN" : "US"),
      sector: quote?.sector ?? ("Technology" as Sector),
    };
  });

  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const pnl = value - cost;
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);

  for (const r of rows) r.weight = value > 0 ? r.value / value : 0;

  const byRegion = groupBy(rows, (r) => r.region).map(([region, group]) => ({
    region,
    value: sum(group, (r) => r.value),
    share: value > 0 ? sum(group, (r) => r.value) / value : 0,
    pnl: sum(group, (r) => r.pnl),
  }));

  const bySector = groupBy(rows, (r) => r.sector)
    .map(([sector, group]) => ({
      sector,
      value: sum(group, (r) => r.value),
      share: value > 0 ? sum(group, (r) => r.value) / value : 0,
      pnl: sum(group, (r) => r.pnl),
    }))
    .sort((a, b) => b.value - a.value);

  const byDay = rows.slice().sort((a, b) => b.dayPnl - a.dayPnl);

  const foreign = rows.filter((r) => r.position.currency !== baseCurrency);

  return {
    positions: rows,
    cost,
    value,
    pnl,
    pnlPercent: cost > 0 ? (pnl / cost) * 100 : 0,
    dayPnl,
    // Yesterday's close value is today's value less today's P&L.
    dayPnlPercent: value - dayPnl > 0 ? (dayPnl / (value - dayPnl)) * 100 : 0,
    baseCurrency,
    byRegion: byRegion.sort((a, b) => b.value - a.value),
    bySector,
    contributors: byDay.filter((r) => r.dayPnl > 0).slice(0, 3).map((r) => ({ position: r.position, dayPnl: r.dayPnl })),
    detractors: byDay.filter((r) => r.dayPnl < 0).slice(-3).reverse().map((r) => ({ position: r.position, dayPnl: r.dayPnl })),
    fxExposure: value > 0 ? sum(foreign, (r) => r.value) / value : 0,
    pricedCount: rows.filter((r) => r.quote).length,
  };
}

function sum<T>(items: T[], f: (t: T) => number): number {
  let s = 0;
  for (const i of items) s += f(i);
  return s;
}

function groupBy<T, K>(items: T[], key: (t: T) => K): [K, T[]][] {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return Array.from(map.entries());
}

/**
 * Herfindahl-based concentration, 0 (perfectly diversified) to 1 (one name).
 * A blunt instrument, but it catches the book that is 70% one position.
 */
export function concentration(weights: number[]): number {
  if (weights.length === 0) return 0;
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  const floor = 1 / weights.length;
  return weights.length === 1 ? 1 : Math.max(0, (hhi - floor) / (1 - floor));
}
