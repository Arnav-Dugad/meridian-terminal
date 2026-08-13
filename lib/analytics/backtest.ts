import type { Candle } from "@/lib/twelvedata/types";
import {
  bollinger,
  ema,
  macd,
  maxDrawdown,
  rsi,
  sharpe,
  sma,
  sortino,
  stdev,
  type MaybeNumber,
} from "@/lib/analytics/indicators";

/**
 * Strategy backtesting.
 *
 * Runs a rule over historical bars and reports what it would have done. The
 * indicators are the same ones the chart draws, so a signal you can see is a
 * signal you can test.
 *
 * ── Two things this deliberately gets right ───────────────────────────────
 *
 * **No lookahead.** A signal computed from bar *i* is executed at the open of
 * bar *i+1*. Backtests that buy at the close of the bar that generated the
 * signal are trading on information they could not have had, and they are the
 * single most common reason a strategy looks brilliant on paper and fails
 * live.
 *
 * **Costs are charged.** Every entry and exit pays a configurable cost in
 * basis points. Frictionless backtests make high-frequency rules look far
 * better than they are, and the difference compounds.
 *
 * The result is compared against buy-and-hold over the same window, because a
 * strategy that returns 40% in a year the index returned 60% has lost money in
 * every sense that matters.
 */

export type StrategyId = "ema-cross" | "rsi-reversion" | "macd-signal" | "bollinger-breakout" | "golden-cross";

export interface StrategySpec {
  id: StrategyId;
  label: string;
  description: string;
  /** The idea in one line, for the results panel. */
  premise: string;
}

export const STRATEGIES: StrategySpec[] = [
  {
    id: "ema-cross",
    label: "EMA 20/50 cross",
    description: "Long while the 20-period EMA is above the 50, flat otherwise.",
    premise: "Trend following. Catches sustained moves and gives back the turn at each end.",
  },
  {
    id: "golden-cross",
    label: "Golden cross (50/200)",
    description: "Long while the 50-period SMA is above the 200.",
    premise: "The slowest classic trend filter. Few trades, long holds, deep drawdowns tolerated.",
  },
  {
    id: "rsi-reversion",
    label: "RSI mean reversion",
    description: "Buy when RSI(14) closes below 30, sell when it closes above 55.",
    premise: "Counter-trend. Works in ranges, gets run over in trends.",
  },
  {
    id: "macd-signal",
    label: "MACD signal cross",
    description: "Long while the MACD line is above its signal line.",
    premise: "Momentum. Faster than a moving-average cross, and noisier for it.",
  },
  {
    id: "bollinger-breakout",
    label: "Bollinger breakout",
    description: "Buy a close above the upper band, exit on a close below the middle band.",
    premise: "Volatility expansion. Assumes a break from a squeeze continues.",
  },
];

export interface Trade {
  entryIndex: number;
  exitIndex: number | null;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  /** Net of costs, as a percentage. */
  returnPercent: number | null;
  barsHeld: number;
}

export interface BacktestResult {
  strategy: StrategyId;
  trades: Trade[];
  /** Equity curve, starting at 100. */
  equity: number[];
  /** Buy-and-hold over the same window, starting at 100. */
  benchmark: number[];
  timestamps: number[];

  totalReturn: number;
  benchmarkReturn: number;
  /** Strategy return less benchmark return. */
  alpha: number;
  cagr: number;
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  sharpe: number;
  sortino: number;
  winRate: number;
  tradeCount: number;
  avgWin: number;
  avgLoss: number;
  /** Gross profit divided by gross loss. */
  profitFactor: number;
  /** Share of bars spent holding a position. */
  exposure: number;
  bestTrade: number;
  worstTrade: number;
  avgBarsHeld: number;
  verdict: string;
}

export interface BacktestOptions {
  /** Round-trip cost per side, in basis points. 5 bps ≈ a retail equity fee. */
  costBps?: number;
  /** Bars per year, for annualising. 252 daily, 52 weekly, 12 monthly. */
  periodsPerYear?: number;
  riskFreeRate?: number;
}

/**
 * Produce a long/flat position series for a strategy.
 * `true` at index i means "the rule says be long, as of bar i's close".
 */
function signalsFor(strategy: StrategyId, candles: readonly Candle[]): boolean[] {
  const closes = candles.map((c) => c.c);
  const n = closes.length;
  const out = new Array<boolean>(n).fill(false);

  const bothAbove = (fast: MaybeNumber[], slow: MaybeNumber[]) => {
    for (let i = 0; i < n; i++) {
      const f = fast[i];
      const s = slow[i];
      out[i] = f != null && s != null && f > s;
    }
  };

  switch (strategy) {
    case "ema-cross":
      bothAbove(ema(closes, 20), ema(closes, 50));
      break;

    case "golden-cross":
      bothAbove(sma(closes, 50), sma(closes, 200));
      break;

    case "macd-signal": {
      const m = macd(closes);
      for (let i = 0; i < n; i++) {
        const line = m.macd[i];
        const sig = m.signal[i];
        out[i] = line != null && sig != null && line > sig;
      }
      break;
    }

    case "rsi-reversion": {
      const r = rsi(closes, 14);
      // Stateful: enter below 30, hold until above 55. Evaluating each bar
      // independently would flip in and out on every wobble.
      let holding = false;
      for (let i = 0; i < n; i++) {
        const v = r[i];
        if (v == null) {
          out[i] = false;
          continue;
        }
        if (!holding && v < 30) holding = true;
        else if (holding && v > 55) holding = false;
        out[i] = holding;
      }
      break;
    }

    case "bollinger-breakout": {
      const b = bollinger(closes, 20, 2);
      let holding = false;
      for (let i = 0; i < n; i++) {
        const upper = b.upper[i];
        const mid = b.middle[i];
        const price = closes[i]!;
        if (upper == null || mid == null) {
          out[i] = false;
          continue;
        }
        if (!holding && price > upper) holding = true;
        else if (holding && price < mid) holding = false;
        out[i] = holding;
      }
      break;
    }
  }

  return out;
}

export function runBacktest(
  strategy: StrategyId,
  candles: readonly Candle[],
  options: BacktestOptions = {},
): BacktestResult | null {
  const { costBps = 5, periodsPerYear = 252, riskFreeRate = 0.05 } = options;
  if (candles.length < 60) return null;

  const signals = signalsFor(strategy, candles);
  const cost = costBps / 10_000;

  const equity: number[] = [100];
  const benchmark: number[] = [100];
  const timestamps: number[] = [candles[0]!.t];
  const trades: Trade[] = [];
  const periodReturns: number[] = [];

  let cash = 100;
  let position = 0; // Units held.
  let entryIndex = -1;
  let entryPrice = 0;
  let barsInMarket = 0;

  const firstClose = candles[0]!.c;

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i]!;
    // The signal from the *previous* bar is what we may act on now. This is
    // the no-lookahead rule, and it is the whole reason the loop is offset.
    const want = signals[i - 1] ?? false;
    const holding = position > 0;

    if (want && !holding) {
      // Enter at this bar's open.
      const price = bar.o > 0 ? bar.o : bar.c;
      position = (cash * (1 - cost)) / price;
      cash = 0;
      entryIndex = i;
      entryPrice = price;
    } else if (!want && holding) {
      const price = bar.o > 0 ? bar.o : bar.c;
      cash = position * price * (1 - cost);
      const grossReturn = ((price - entryPrice) / entryPrice) * 100;
      trades.push({
        entryIndex,
        exitIndex: i,
        entryTime: candles[entryIndex]!.t,
        exitTime: bar.t,
        entryPrice,
        exitPrice: price,
        // Both sides of the round trip are charged.
        returnPercent: grossReturn - costBps / 50,
        barsHeld: i - entryIndex,
      });
      position = 0;
    }

    if (position > 0) barsInMarket++;

    const value = cash + position * bar.c;
    const prev = equity[equity.length - 1]!;
    equity.push(value);
    benchmark.push((bar.c / firstClose) * 100);
    timestamps.push(bar.t);
    periodReturns.push(prev > 0 ? (value - prev) / prev : 0);
  }

  // Close any open position at the last price so the curve is comparable.
  if (position > 0) {
    const last = candles[candles.length - 1]!;
    const grossReturn = ((last.c - entryPrice) / entryPrice) * 100;
    trades.push({
      entryIndex,
      exitIndex: null,
      entryTime: candles[entryIndex]!.t,
      exitTime: null,
      entryPrice,
      exitPrice: last.c,
      returnPercent: grossReturn - costBps / 50,
      barsHeld: candles.length - 1 - entryIndex,
    });
  }

  const finalEquity = equity[equity.length - 1]!;
  const totalReturn = finalEquity - 100;
  const benchmarkReturn = benchmark[benchmark.length - 1]! - 100;

  const years = (candles[candles.length - 1]!.t - candles[0]!.t) / (365.25 * 86_400_000);
  const cagr = years > 0.08 ? (Math.pow(finalEquity / 100, 1 / years) - 1) * 100 : totalReturn;

  const closed = trades.filter((t) => t.returnPercent != null);
  const wins = closed.filter((t) => (t.returnPercent ?? 0) > 0);
  const losses = closed.filter((t) => (t.returnPercent ?? 0) <= 0);

  const grossProfit = wins.reduce((s, t) => s + (t.returnPercent ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.returnPercent ?? 0), 0));

  const returnsPct = closed.map((t) => t.returnPercent ?? 0);

  return {
    strategy,
    trades,
    equity,
    benchmark,
    timestamps,
    totalReturn,
    benchmarkReturn,
    alpha: totalReturn - benchmarkReturn,
    cagr,
    maxDrawdown: maxDrawdown(equity).depth,
    benchmarkMaxDrawdown: maxDrawdown(benchmark).depth,
    sharpe: sharpe(periodReturns, riskFreeRate, periodsPerYear),
    sortino: sortino(periodReturns, riskFreeRate, periodsPerYear),
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    tradeCount: closed.length,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    exposure: candles.length > 1 ? (barsInMarket / (candles.length - 1)) * 100 : 0,
    bestTrade: returnsPct.length > 0 ? Math.max(...returnsPct) : 0,
    worstTrade: returnsPct.length > 0 ? Math.min(...returnsPct) : 0,
    avgBarsHeld: closed.length > 0 ? closed.reduce((s, t) => s + t.barsHeld, 0) / closed.length : 0,
    verdict: verdictFor(totalReturn, benchmarkReturn, closed.length, stdev(returnsPct)),
  };
}

/**
 * A blunt, honest read.
 *
 * Deliberately unflattering: the default outcome for a simple rule on a single
 * instrument over one window is that it underperforms holding, and a backtest
 * tool that does not say so is selling something.
 */
function verdictFor(
  total: number,
  benchmark: number,
  trades: number,
  dispersion: number,
): string {
  if (trades === 0) return "This rule never triggered over the window. Try a longer range.";
  if (trades < 5) {
    return `Only ${trades} trade${trades === 1 ? "" : "s"} — far too few to tell skill from luck, whatever the return says.`;
  }

  const edge = total - benchmark;
  const noisy = dispersion > 18;

  if (edge > 5) {
    return noisy
      ? `Beat buy-and-hold by ${edge.toFixed(1)} points, but trade outcomes are widely dispersed — a handful of trades are carrying it.`
      : `Beat buy-and-hold by ${edge.toFixed(1)} points with reasonably consistent trades over this window.`;
  }
  if (edge < -5) {
    return `Underperformed buy-and-hold by ${Math.abs(edge).toFixed(1)} points. Simply holding did better, before you count the effort.`;
  }
  return "Roughly matched buy-and-hold. The activity bought no edge over this window.";
}
