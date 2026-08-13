import type { Candle } from "@/lib/twelvedata/types";

/**
 * Seasonality.
 *
 * Month-by-month behaviour over as many years as the loaded history allows,
 * computed entirely from bars already on the client — no request, no API cost.
 *
 * The honest framing matters here more than in most panels. Monthly
 * seasonality is the easiest thing in finance to over-read: with twelve
 * buckets and ten years you have ten observations per bucket, and something
 * will always look striking. So every cell carries its sample count and hit
 * rate alongside the mean, and the summary refuses to call anything a pattern
 * below a threshold of consistency.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface MonthStat {
  /** 0-indexed, January is 0. */
  month: number;
  label: string;
  /** Mean return for this month across years, in percent. */
  meanReturn: number;
  /** Median, which is less swayed by a single crash or melt-up. */
  medianReturn: number;
  /** Share of years this month closed positive, 0 to 1. */
  hitRate: number;
  years: number;
  best: { year: number; value: number } | null;
  worst: { year: number; value: number } | null;
}

export interface YearMonthCell {
  year: number;
  month: number;
  value: number;
}

export interface SeasonalityResult {
  months: MonthStat[];
  /** Every year-month observation, for the heatmap grid. */
  cells: YearMonthCell[];
  years: number[];
  bestMonth: MonthStat | null;
  worstMonth: MonthStat | null;
  /** Largest absolute mean, used to scale the colour ramp. */
  extent: number;
  totalYears: number;
  verdict: string;
}

/**
 * Bucket candles into calendar months and measure each month's return.
 *
 * Returns are computed close-to-close across the month boundary, so a month's
 * figure is the change from the last close of the previous month to the last
 * close of this one — which is how monthly returns are conventionally quoted,
 * and avoids the first trading day being silently excluded.
 */
export function analyseSeasonality(candles: readonly Candle[]): SeasonalityResult | null {
  if (candles.length < 250) return null;

  // Last close of each calendar month, in order.
  const monthEnd = new Map<string, { close: number; year: number; month: number }>();
  for (const c of candles) {
    const d = new Date(c.t);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    monthEnd.set(`${year}-${month}`, { close: c.c, year, month });
  }

  const ordered = Array.from(monthEnd.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  if (ordered.length < 14) return null;

  const cells: YearMonthCell[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const curr = ordered[i]!;
    if (prev.close <= 0) continue;
    cells.push({
      year: curr.year,
      month: curr.month,
      value: ((curr.close - prev.close) / prev.close) * 100,
    });
  }

  if (cells.length < 12) return null;

  const months: MonthStat[] = [];
  for (let m = 0; m < 12; m++) {
    const values = cells.filter((c) => c.month === m);
    if (values.length === 0) {
      months.push({
        month: m,
        label: MONTH_NAMES[m]!,
        meanReturn: 0,
        medianReturn: 0,
        hitRate: 0,
        years: 0,
        best: null,
        worst: null,
      });
      continue;
    }

    const returns = values.map((v) => v.value).sort((a, b) => a - b);
    const mid = Math.floor(returns.length / 2);
    const median =
      returns.length % 2 === 0 ? ((returns[mid - 1]! + returns[mid]!) / 2) : returns[mid]!;

    const best = values.reduce((a, b) => (b.value > a.value ? b : a));
    const worst = values.reduce((a, b) => (b.value < a.value ? b : a));

    months.push({
      month: m,
      label: MONTH_NAMES[m]!,
      meanReturn: returns.reduce((s, v) => s + v, 0) / returns.length,
      medianReturn: median,
      hitRate: values.filter((v) => v.value > 0).length / values.length,
      years: values.length,
      best: { year: best.year, value: best.value },
      worst: { year: worst.year, value: worst.value },
    });
  }

  const populated = months.filter((m) => m.years > 0);
  const bestMonth = populated.length ? populated.reduce((a, b) => (b.meanReturn > a.meanReturn ? b : a)) : null;
  const worstMonth = populated.length ? populated.reduce((a, b) => (b.meanReturn < a.meanReturn ? b : a)) : null;

  const years = Array.from(new Set(cells.map((c) => c.year))).sort((a, b) => b - a);
  const extent = Math.max(4, ...months.map((m) => Math.abs(m.meanReturn)));

  return {
    months,
    cells,
    years,
    bestMonth,
    worstMonth,
    extent,
    totalYears: years.length,
    verdict: verdictFor(bestMonth, worstMonth, years.length),
  };
}

/**
 * Only call something a tendency when the sample and the consistency both
 * support it. Anything else is described as noise, explicitly.
 */
function verdictFor(
  best: MonthStat | null,
  worst: MonthStat | null,
  totalYears: number,
): string {
  if (!best || !worst) return "Not enough history to read seasonality.";

  if (totalYears < 5) {
    return `Only ${totalYears} year${totalYears === 1 ? "" : "s"} of history here — far too little for monthly patterns to mean anything. Load a longer range.`;
  }

  const strongBest = best.hitRate >= 0.65 && best.years >= 5 && best.meanReturn > 1.5;
  const strongWorst = worst.hitRate <= 0.4 && worst.years >= 5 && worst.meanReturn < -1;

  if (strongBest && strongWorst) {
    return `Over ${totalYears} years, ${best.label} has been the strongest month — up ${best.meanReturn.toFixed(1)}% on average and positive ${(best.hitRate * 100).toFixed(0)}% of the time — while ${worst.label} has been the weakest at ${worst.meanReturn.toFixed(1)}%. Consistent enough to be worth knowing, not enough to trade on alone.`;
  }
  if (strongBest) {
    return `${best.label} stands out over ${totalYears} years: up ${best.meanReturn.toFixed(1)}% on average and positive in ${(best.hitRate * 100).toFixed(0)}% of them. The rest of the calendar looks like noise.`;
  }
  if (strongWorst) {
    return `${worst.label} has been reliably weak over ${totalYears} years, averaging ${worst.meanReturn.toFixed(1)}%. No month stands out on the upside.`;
  }
  return `No month shows a consistent pattern across these ${totalYears} years. The spread between the best and worst month is mostly a handful of outlier years rather than a tendency.`;
}
