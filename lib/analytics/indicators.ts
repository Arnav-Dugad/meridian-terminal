import type { Candle } from "@/lib/twelvedata/types";

/**
 * Technical and statistical primitives.
 *
 * Computed in the browser from the candles already on screen. Twelve Data
 * sells these as separate endpoints, but every one of them is a pure function
 * of the series we have — paying a credit per indicator per symbol to receive
 * arithmetic back over the network would be slower and would put a rate limit
 * between the user and a slider they are dragging.
 *
 * Every series returned is aligned to the input length, with `null` in the
 * warm-up region. That alignment is deliberate: the renderer indexes
 * indicators by candle position, and silently shortened arrays are the classic
 * way indicator overlays end up drawn one bar off.
 */

export type MaybeNumber = number | null;

/* ── Moving averages ──────────────────────────────────────────────────────── */

export function sma(values: readonly number[], period: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: readonly number[], period: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values — the standard convention,
  // and the reason two charting packages can disagree on early EMA values.
  let acc = 0;
  for (let i = 0; i < period; i++) acc += values[i]!;
  let prev = acc / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing — the 1/n variant used by RSI, ATR and ADX. */
function wilder(values: readonly number[], period: number): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/* ── Oscillators ──────────────────────────────────────────────────────────── */

export function rsi(closes: readonly number[], period = 14): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }

  const avgGain = wilder(gains.slice(1), period);
  const avgLoss = wilder(losses.slice(1), period);

  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g == null || l == null) continue;
    // A period with no losses is RSI 100 by definition, not a divide-by-zero.
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export interface MacdResult {
  macd: MaybeNumber[];
  signal: MaybeNumber[];
  histogram: MaybeNumber[];
}

export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine: MaybeNumber[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f != null && s != null ? f - s : null;
  });

  // The signal line is an EMA of the MACD line, which only exists past the
  // slow warm-up — so it is computed on the compacted tail and re-aligned.
  const firstValid = macdLine.findIndex((v) => v != null);
  const signal: MaybeNumber[] = new Array(closes.length).fill(null);
  if (firstValid >= 0) {
    const compact = macdLine.slice(firstValid).map((v) => v ?? 0);
    const sig = ema(compact, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i] ?? null;
  }

  const histogram: MaybeNumber[] = macdLine.map((m, i) => {
    const s = signal[i];
    return m != null && s != null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}

export interface StochasticResult {
  k: MaybeNumber[];
  d: MaybeNumber[];
}

export function stochastic(candles: readonly Candle[], period = 14, smooth = 3): StochasticResult {
  const k: MaybeNumber[] = new Array(candles.length).fill(null);

  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const c = candles[j]!;
      if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l;
    }
    const close = candles[i]!.c;
    k[i] = hi === lo ? 50 : ((close - lo) / (hi - lo)) * 100;
  }

  const firstValid = k.findIndex((v) => v != null);
  const d: MaybeNumber[] = new Array(candles.length).fill(null);
  if (firstValid >= 0) {
    const compact = k.slice(firstValid).map((v) => v ?? 0);
    const smoothed = sma(compact, smooth);
    for (let i = 0; i < smoothed.length; i++) d[firstValid + i] = smoothed[i] ?? null;
  }

  return { k, d };
}

/* ── Volatility ───────────────────────────────────────────────────────────── */

export interface BollingerResult {
  upper: MaybeNumber[];
  middle: MaybeNumber[];
  lower: MaybeNumber[];
  /** (upper - lower) / middle — the squeeze indicator. */
  bandwidth: MaybeNumber[];
}

export function bollinger(closes: readonly number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: MaybeNumber[] = new Array(closes.length).fill(null);
  const lower: MaybeNumber[] = new Array(closes.length).fill(null);
  const bandwidth: MaybeNumber[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean == null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j]! - mean;
      variance += d * d;
    }
    // Population standard deviation, which is what Bollinger specified.
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
    bandwidth[i] = mean !== 0 ? ((mult * sd * 2) / mean) * 100 : null;
  }

  return { upper, middle, lower, bandwidth };
}

export function atr(candles: readonly Candle[], period = 14): MaybeNumber[] {
  if (candles.length === 0) return [];
  const tr: number[] = [candles[0]!.h - candles[0]!.l];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.c;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose)));
  }
  return wilder(tr, period);
}

/* ── Volume ───────────────────────────────────────────────────────────────── */

/** On-balance volume. */
export function obv(candles: readonly Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  let acc = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    if (c.c > prev.c) acc += c.v;
    else if (c.c < prev.c) acc -= c.v;
    out[i] = acc;
  }
  return out;
}

/** Session-anchored VWAP. Resets whenever the calendar day changes. */
export function vwap(candles: readonly Candle[]): MaybeNumber[] {
  const out: MaybeNumber[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let currentDay = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const day = Math.floor(c.t / 86_400_000);
    if (day !== currentDay) {
      currentDay = day;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * c.v;
    cumV += c.v;
    out[i] = cumV > 0 ? cumPV / cumV : typical;
  }
  return out;
}

/* ── Return statistics ────────────────────────────────────────────────────── */

/** Simple period-over-period returns, as fractions. */
export function returns(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    out.push(prev === 0 ? 0 : (values[i]! - prev) / prev);
  }
  return out;
}

export function logReturns(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    out.push(prev > 0 && cur > 0 ? Math.log(cur / prev) : 0);
  }
  return out;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values: readonly number[], sample = true): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / (sample ? n - 1 : n));
}

/**
 * Annualised volatility from a return series.
 * `periodsPerYear` is 252 for daily bars, 52 weekly, 12 monthly.
 */
export function annualisedVolatility(rets: readonly number[], periodsPerYear = 252): number {
  return stdev(rets) * Math.sqrt(periodsPerYear) * 100;
}

/** Largest peak-to-trough decline, as a positive percentage. */
export function maxDrawdown(values: readonly number[]): { depth: number; peakIndex: number; troughIndex: number } {
  let peak = -Infinity;
  let peakIdx = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > worst) {
      worst = dd;
      worstPeak = peakIdx;
      worstTrough = i;
    }
  }
  return { depth: worst * 100, peakIndex: worstPeak, troughIndex: worstTrough };
}

/** Sharpe ratio. `riskFree` is an annual rate as a fraction, e.g. 0.065. */
export function sharpe(rets: readonly number[], riskFree = 0.065, periodsPerYear = 252): number {
  if (rets.length < 2) return 0;
  const excess = rets.map((r) => r - riskFree / periodsPerYear);
  const sd = stdev(excess);
  return sd === 0 ? 0 : (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

/** Downside-deviation Sortino ratio. */
export function sortino(rets: readonly number[], riskFree = 0.065, periodsPerYear = 252): number {
  if (rets.length < 2) return 0;
  const target = riskFree / periodsPerYear;
  const excess = rets.map((r) => r - target);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return 0;
  let acc = 0;
  for (const d of downside) acc += d * d;
  const dd = Math.sqrt(acc / rets.length);
  return dd === 0 ? 0 : (mean(excess) / dd) * Math.sqrt(periodsPerYear);
}

/* ── Cross-market statistics ──────────────────────────────────────────────── */

/**
 * Pearson correlation over the overlapping tail of two return series.
 *
 * This is the engine behind the cross-market panels: how tightly an NSE
 * listing tracks the S&P, or which US name a given Indian one most resembles.
 */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const aa = a.slice(a.length - n);
  const bb = b.slice(b.length - n);
  const ma = mean(aa);
  const mb = mean(bb);

  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = aa[i]! - ma;
    const y = bb[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

/** Beta of `asset` against `benchmark`, over the overlapping tail. */
export function beta(asset: readonly number[], benchmark: readonly number[]): number {
  const n = Math.min(asset.length, benchmark.length);
  if (n < 3) return 0;
  const a = asset.slice(asset.length - n);
  const b = benchmark.slice(benchmark.length - n);
  const mb = mean(b);
  const ma = mean(a);

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const db = b[i]! - mb;
    cov += (a[i]! - ma) * db;
    varB += db * db;
  }
  return varB === 0 ? 0 : cov / varB;
}

export interface Regression {
  slope: number;
  intercept: number;
  /** Coefficient of determination. */
  r2: number;
  predict: (x: number) => number;
}

/** Ordinary least squares against the index position. */
export function linearRegression(values: readonly number[]): Regression {
  const n = values.length;
  if (n < 2) {
    const c = values[0] ?? 0;
    return { slope: 0, intercept: c, r2: 0, predict: () => c };
  }

  const mx = (n - 1) / 2;
  const my = mean(values);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxy += dx * (values[i]! - my);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * i + intercept;
    ssRes += (values[i]! - pred) ** 2;
    ssTot += (values[i]! - my) ** 2;
  }

  return {
    slope,
    intercept,
    r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    predict: (x: number) => slope * x + intercept,
  };
}

/** Rebase a series so it starts at 100 — how unlike-priced assets are compared. */
export function normalise(values: readonly number[], base = 100): number[] {
  const first = values.find((v) => v > 0);
  if (!first) return values.map(() => base);
  return values.map((v) => (v / first) * base);
}

/* ── Support / resistance ─────────────────────────────────────────────────── */

export interface PivotLevel {
  price: number;
  /** How many bars reacted at this level. */
  strength: number;
  kind: "support" | "resistance";
}

/**
 * Fractal pivots, clustered into levels.
 *
 * A raw swing-high list is noise; what a reader wants is the handful of prices
 * the market keeps returning to. Pivots within half an ATR of each other are
 * merged, and the cluster's hit count becomes its strength.
 */
export function pivotLevels(candles: readonly Candle[], lookback = 3, maxLevels = 5): PivotLevel[] {
  if (candles.length < lookback * 2 + 1) return [];

  const atrSeries = atr(candles, 14);
  const lastAtr = [...atrSeries].reverse().find((v) => v != null) ?? 0;
  const tolerance = Math.max(lastAtr * 0.5, (candles[candles.length - 1]?.c ?? 1) * 0.004);

  const raw: { price: number; kind: "support" | "resistance" }[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const o = candles[j]!;
      if (o.h >= c.h) isHigh = false;
      if (o.l <= c.l) isLow = false;
    }
    if (isHigh) raw.push({ price: c.h, kind: "resistance" });
    if (isLow) raw.push({ price: c.l, kind: "support" });
  }

  const clusters: { sum: number; count: number; kind: "support" | "resistance" }[] = [];
  for (const p of raw) {
    const hit = clusters.find(
      (c) => c.kind === p.kind && Math.abs(c.sum / c.count - p.price) <= tolerance,
    );
    if (hit) {
      hit.sum += p.price;
      hit.count += 1;
    } else {
      clusters.push({ sum: p.price, count: 1, kind: p.kind });
    }
  }

  return clusters
    .map((c) => ({ price: c.sum / c.count, strength: c.count, kind: c.kind }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxLevels);
}

/* ── Composite read ───────────────────────────────────────────────────────── */

export type Stance = "strong-buy" | "buy" | "neutral" | "sell" | "strong-sell";

export interface TechnicalRead {
  score: number;
  stance: Stance;
  signals: { label: string; verdict: "bullish" | "bearish" | "neutral"; detail: string }[];
}

/**
 * A blended technical read across trend, momentum and volatility.
 *
 * Presented as one of five stances rather than a precise number, because the
 * underlying inputs do not support more precision than that. It is a summary
 * of what the indicators say, not advice.
 */
export function technicalRead(candles: readonly Candle[]): TechnicalRead {
  const closes = candles.map((c) => c.c);
  const signals: TechnicalRead["signals"] = [];
  let score = 0;

  const last = closes[closes.length - 1] ?? 0;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const e20 = ema20[ema20.length - 1];
  const e50 = ema50[ema50.length - 1];

  if (e20 != null && e50 != null) {
    const bullish = e20 > e50 && last > e20;
    const bearish = e20 < e50 && last < e20;
    score += bullish ? 2 : bearish ? -2 : 0;
    signals.push({
      label: "Trend",
      verdict: bullish ? "bullish" : bearish ? "bearish" : "neutral",
      detail:
        bullish
          ? "Price above a rising 20/50 EMA stack"
          : bearish
            ? "Price below a falling 20/50 EMA stack"
            : "EMAs entangled — no committed trend",
    });
  }

  const rsiSeries = rsi(closes, 14);
  const r = rsiSeries[rsiSeries.length - 1];
  if (r != null) {
    const verdict = r > 70 ? "bearish" : r < 30 ? "bullish" : r > 55 ? "bullish" : r < 45 ? "bearish" : "neutral";
    score += r > 70 ? -1 : r < 30 ? 1 : r > 55 ? 1 : r < 45 ? -1 : 0;
    signals.push({
      label: "RSI (14)",
      verdict,
      detail:
        r > 70
          ? `Overbought at ${r.toFixed(1)}`
          : r < 30
            ? `Oversold at ${r.toFixed(1)}`
            : `Neutral at ${r.toFixed(1)}`,
    });
  }

  const m = macd(closes);
  const hist = m.histogram[m.histogram.length - 1];
  const prevHist = m.histogram[m.histogram.length - 2];
  if (hist != null && prevHist != null) {
    const expanding = Math.abs(hist) > Math.abs(prevHist);
    const verdict = hist > 0 ? "bullish" : hist < 0 ? "bearish" : "neutral";
    score += hist > 0 ? (expanding ? 2 : 1) : hist < 0 ? (expanding ? -2 : -1) : 0;
    signals.push({
      label: "MACD",
      verdict,
      detail: `Histogram ${hist > 0 ? "positive" : "negative"} and ${expanding ? "expanding" : "narrowing"}`,
    });
  }

  const bb = bollinger(closes, 20, 2);
  const upper = bb.upper[bb.upper.length - 1];
  const lower = bb.lower[bb.lower.length - 1];
  if (upper != null && lower != null && upper > lower) {
    const pos = (last - lower) / (upper - lower);
    const verdict = pos > 0.95 ? "bearish" : pos < 0.05 ? "bullish" : "neutral";
    score += pos > 0.95 ? -1 : pos < 0.05 ? 1 : 0;
    signals.push({
      label: "Bollinger",
      verdict,
      detail: `${(pos * 100).toFixed(0)}% of the way up the band`,
    });
  }

  const stance: Stance =
    score >= 4 ? "strong-buy" : score >= 2 ? "buy" : score <= -4 ? "strong-sell" : score <= -2 ? "sell" : "neutral";

  return { score, stance, signals };
}

export const STANCE_LABEL: Record<Stance, string> = {
  "strong-buy": "Strong bullish",
  buy: "Bullish",
  neutral: "Neutral",
  sell: "Bearish",
  "strong-sell": "Strong bearish",
};
