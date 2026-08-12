import { hashCode } from "@/lib/utils";
import type { Instrument } from "@/lib/market/universe";
import { EXCHANGES } from "@/lib/market/exchanges";
import { zoneOffsetMs } from "@/lib/market/timezone";
import type { Candle, Interval, Quote, RangeKey, Series } from "@/lib/twelvedata/types";
import { RANGE_SPEC } from "@/lib/twelvedata/types";

/**
 * Deterministic market simulation.
 *
 * This exists so the product is fully explorable before an API key is added,
 * and so a provider outage degrades into something coherent instead of a wall
 * of dashes. It is labelled as simulated everywhere it surfaces.
 *
 * The important property is that it is not random noise. Real tape has
 * structure: names inside a sector move together, sectors move with the index,
 * small caps swing wider than mega caps, and volume spikes when price does. A
 * heatmap of uncorrelated random walks looks obviously fake at a glance, so
 * prices here are built from a three-factor model --
 *
 *     log P = log P0 + beta * market(region) + gamma * sector + idiosyncratic
 *
 * -- over smooth fractal noise rather than independent draws. Everything is a
 * pure function of (symbol, timestamp), so the server and the client compute
 * identical values and hydration stays clean.
 */

/* ── Smooth noise ─────────────────────────────────────────────────────────── */

/** Deterministic hash of an integer lattice point to [-1, 1]. */
function latticeNoise(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967295) * 2 - 1;
}

/** Smoothstep-interpolated value noise -- continuous and differentiable. */
function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = latticeNoise(seed, i);
  const b = latticeNoise(seed, i + 1);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/**
 * Fractal Brownian motion. Summing octaves of value noise at halving
 * amplitude produces the self-similar roughness that makes a synthetic price
 * path read as a market rather than a sine wave.
 */
function fbm(seed: number, x: number, octaves = 5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 7919, x * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.07; // Non-integer so octaves never phase-align.
  }
  return sum / norm;
}

const DAY_MS = 86_400_000;

/** Continuous time in days since epoch. */
function days(t: number): number {
  return t / DAY_MS;
}

/* ── Factors ──────────────────────────────────────────────────────────────── */

const SEED_MARKET_IN = hashCode("meridian:market:IN");
const SEED_MARKET_US = hashCode("meridian:market:US");
const SEED_GLOBAL = hashCode("meridian:global");

/** Global risk appetite -- the slow tide both regions ride. */
function globalFactor(td: number): number {
  return fbm(SEED_GLOBAL, td / 34, 4);
}

/** Regional index factor. Correlated with the global tide but not identical. */
function marketFactor(region: "IN" | "US", td: number): number {
  const seed = region === "IN" ? SEED_MARKET_IN : SEED_MARKET_US;
  const local = fbm(seed, td / 11, 5);
  // India carries a structurally higher drift and a fatter local component;
  // the US series is dominated by the global tide.
  return region === "IN" ? 0.62 * local + 0.38 * globalFactor(td) : 0.45 * local + 0.55 * globalFactor(td);
}

function sectorFactor(sector: string, region: string, td: number): number {
  return fbm(hashCode(`sector:${sector}:${region}`), td / 8.5, 4);
}

/** Per-name annualised volatility, inferred from size. */
function volatilityOf(inst: Instrument): number {
  if (inst.kind === "index") return 0.13;
  const capUsd = inst.currency === "INR" ? inst.seedCap / 88 : inst.seedCap;
  if (capUsd > 1e12) return 0.26;
  if (capUsd > 3e11) return 0.30;
  if (capUsd > 1e11) return 0.34;
  if (capUsd > 3e10) return 0.40;
  return 0.48;
}

/** Sensitivity to the regional index. */
function betaOf(inst: Instrument): number {
  if (inst.kind === "index") return 1;
  const b = 0.75 + ((hashCode(inst.symbol) % 100) / 100) * 0.8;
  return inst.sector === "Utilities" || inst.sector === "Consumer" ? b * 0.75 : b;
}

/**
 * Log-price offset from the seed at time `t`. The three factors are weighted
 * so an index moves ~1% on a day its constituents move ~1.5% -- diversification
 * damping, which is what makes the breadth numbers feel right.
 */
function logOffset(inst: Instrument, t: number): number {
  const td = days(t);
  const vol = volatilityOf(inst);
  const beta = betaOf(inst);
  const seed = hashCode(`sym:${inst.slug}`);

  const market = marketFactor(inst.region, td);
  const sector = inst.kind === "index" ? 0 : sectorFactor(inst.sector, inst.region, td);
  const idio = inst.kind === "index" ? 0 : fbm(seed, td / 3.2, 6);

  // A gentle upward drift so long ranges slope like an equity market.
  const drift = (inst.kind === "index" ? 0.09 : 0.07) * (td / 365) * 0.02;

  const amplitude = vol * 0.55;
  return (
    drift +
    beta * market * amplitude * 0.9 +
    sector * amplitude * 0.5 +
    idio * amplitude * 0.85
  );
}

/** Simulated price for an instrument at an instant. */
export function simulatedPrice(inst: Instrument, t: number = Date.now()): number {
  const anchor = Date.UTC(2026, 0, 1);
  const price = inst.seedPrice * Math.exp(logOffset(inst, t) - logOffset(inst, anchor));
  return roundTick(price);
}

function roundTick(p: number): number {
  if (p >= 1000) return Math.round(p * 100) / 100;
  if (p >= 1) return Math.round(p * 100) / 100;
  return Math.round(p * 10000) / 10000;
}

/* ── Session anchors ──────────────────────────────────────────────────────── */

/**
 * Most recent session open and previous close, in epoch ms, using the
 * exchange's own clock. Weekends roll back to Friday.
 */
function sessionAnchors(inst: Instrument, now: number): { open: number; prevClose: number } {
  const ex = EXCHANGES[inst.exchange];
  const offsetMs = zoneOffsetMs(ex.timezone, now);
  const localNow = now + offsetMs;
  const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS;

  let openLocal = localMidnight + ex.open * 60_000;
  // Before today's open, the "current" session is the previous trading day.
  if (localNow < openLocal) openLocal -= DAY_MS;

  // Roll off weekends.
  for (let guard = 0; guard < 4; guard++) {
    const dow = new Date(openLocal).getUTCDay(); // localised already
    if (dow !== 0 && dow !== 6) break;
    openLocal -= DAY_MS;
  }

  let prevCloseLocal = openLocal - DAY_MS + (ex.close - ex.open) * 60_000;
  for (let guard = 0; guard < 4; guard++) {
    const dow = new Date(prevCloseLocal).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    prevCloseLocal -= DAY_MS;
  }

  return { open: openLocal - offsetMs, prevClose: prevCloseLocal - offsetMs };
}

/* ── Public surface ───────────────────────────────────────────────────────── */

export function simulateQuote(inst: Instrument, now: number = Date.now()): Quote {
  const { open: sessionOpen, prevClose: prevCloseAt } = sessionAnchors(inst, now);

  const price = simulatedPrice(inst, now);
  const previousClose = simulatedPrice(inst, prevCloseAt);
  const open = simulatedPrice(inst, sessionOpen);

  // Sample the intraday path to get an honest high/low rather than max(o, c).
  let dayHigh = Math.max(open, price);
  let dayLow = Math.min(open, price);
  const span = Math.max(now - sessionOpen, 60_000);
  for (let i = 1; i < 24; i++) {
    const p = simulatedPrice(inst, sessionOpen + (span * i) / 24);
    if (p > dayHigh) dayHigh = p;
    if (p < dayLow) dayLow = p;
  }

  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  // 52-week band, sampled coarsely.
  let hi = price;
  let lo = price;
  for (let i = 0; i <= 52; i++) {
    const p = simulatedPrice(inst, now - i * 7 * DAY_MS);
    if (p > hi) hi = p;
    if (p < lo) lo = p;
  }

  const vol = volatilityOf(inst);
  const baseTurnover = inst.kind === "index" ? 0 : inst.seedCap * 0.0022;
  const volume =
    inst.kind === "index"
      ? 0
      : Math.round((baseTurnover / Math.max(price, 0.01)) * (0.6 + Math.abs(changePercent) / (vol * 12)));

  return {
    symbol: inst.symbol,
    slug: inst.slug,
    name: inst.name,
    exchange: inst.exchange,
    region: inst.region,
    currency: inst.currency,
    sector: inst.sector,
    price,
    previousClose,
    open,
    dayHigh: roundTick(dayHigh),
    dayLow: roundTick(dayLow),
    change: roundTick(change),
    changePercent: Math.round(changePercent * 100) / 100,
    volume,
    fiftyTwoWeekHigh: roundTick(hi),
    fiftyTwoWeekLow: roundTick(lo),
    fiftyTwoWeekPosition: hi > lo ? (price - lo) / (hi - lo) : null,
    marketCap: inst.kind === "index" ? null : Math.round(inst.seedCap * (price / inst.seedPrice)),
    timestamp: now,
    isOpen: false,
    source: "simulated",
  };
}

const INTERVAL_MS: Record<Interval, number> = {
  "1min": 60_000,
  "5min": 300_000,
  "15min": 900_000,
  "30min": 1_800_000,
  "1h": 3_600_000,
  "1day": DAY_MS,
  "1week": 7 * DAY_MS,
  "1month": 30 * DAY_MS,
};

export function simulateSeries(
  inst: Instrument,
  range: RangeKey,
  now: number = Date.now(),
): Series {
  const spec = RANGE_SPEC[range];
  const step = INTERVAL_MS[spec.interval];
  const count = spec.outputsize;
  const candles: Candle[] = [];

  // Intraday ranges are compressed into the session window so a "1D" chart
  // spans the trading day rather than a flat 24 hours.
  const intraday = step < DAY_MS;
  const ex = EXCHANGES[inst.exchange];
  const sessionMs = (ex.close - ex.open) * 60_000;
  const { open: sessionOpen } = sessionAnchors(inst, now);

  const endT = intraday && range === "1D" ? Math.min(now, sessionOpen + sessionMs) : now;
  const startT = range === "1D" ? sessionOpen : endT - step * count;
  const dt = (endT - startT) / count;

  let prevClose = simulatedPrice(inst, startT);

  for (let i = 0; i < count; i++) {
    const t0 = startT + dt * i;
    const t1 = t0 + dt;
    const close = simulatedPrice(inst, t1);
    const openPx = prevClose;

    // Wick amplitude scales with the bar's own range plus a floor, so quiet
    // bars still have a little shadow instead of rendering as flat ticks.
    let high = Math.max(openPx, close);
    let low = Math.min(openPx, close);
    for (let k = 1; k < 4; k++) {
      const p = simulatedPrice(inst, t0 + (dt * k) / 4);
      if (p > high) high = p;
      if (p < low) low = p;
    }
    const wick = Math.max(high - low, close * 0.0008) * 0.35;
    const wiggle = valueNoise(hashCode(inst.slug + i), i * 0.61);
    high = high + wick * Math.abs(wiggle);
    low = low - wick * Math.abs(valueNoise(hashCode(inst.slug + "L"), i * 0.43));

    const ret = openPx > 0 ? Math.abs((close - openPx) / openPx) : 0;
    const baseVol =
      inst.kind === "index" ? 0 : (inst.seedCap * 0.0022) / Math.max(close, 0.01) / (DAY_MS / dt);
    const volume = Math.round(baseVol * (0.55 + ret * 40 + Math.abs(wiggle) * 0.5));

    candles.push({
      t: Math.round(t1),
      o: roundTick(openPx),
      h: roundTick(high),
      l: roundTick(Math.max(low, 0.0001)),
      c: roundTick(close),
      v: Math.max(0, volume),
    });
    prevClose = close;
  }

  return {
    symbol: inst.symbol,
    slug: inst.slug,
    interval: spec.interval,
    range,
    currency: inst.currency,
    candles,
    source: "simulated",
  };
}

/** USD/INR reference, simulated. Real rate comes from /exchange_rate. */
export function simulateFx(pair = "USD/INR", now: number = Date.now()): number {
  const base = pair === "USD/INR" ? 88.4 : 1;
  return Math.round(base * Math.exp(fbm(hashCode(pair), days(now) / 26, 4) * 0.035) * 10000) / 10000;
}
