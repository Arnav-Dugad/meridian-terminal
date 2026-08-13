import type { Candle } from "@/lib/twelvedata/types";
import type { EarningsPoint } from "@/lib/providers/types";

/**
 * Earnings drift.
 *
 * How a stock actually behaves around its results, measured rather than
 * assumed. For each past report we take the return over the days *before* the
 * date, the gap on the day itself, and the return over the days *after* —
 * then average across reports.
 *
 * The reason this is worth a panel: post-earnings announcement drift is one of
 * the few effects in equities that has survived decades of scrutiny. Stocks
 * that beat tend to keep drifting up for weeks, and stocks that miss keep
 * drifting down. Whether it holds for *this* name is an empirical question,
 * and this answers it from the price series already on the client.
 *
 * Everything here is descriptive. A pattern in eight past reports is a small
 * sample, and the UI says so.
 */

export interface DriftWindow {
  /** Trading days either side of the report. */
  days: number;
  /** Mean return over the window, in percent. */
  meanReturn: number;
  /** Share of reports where the window was positive, 0 to 1. */
  hitRate: number;
  samples: number;
}

export interface EarningsReaction {
  period: string;
  reportedAt: number;
  epsActual: number | null;
  epsEstimate: number | null;
  surprisePercent: number | null;
  /** Return over the five sessions before the report. */
  preReturn: number | null;
  /** The move on the first session after the report. */
  reactionReturn: number | null;
  /** Return over the ten sessions after the report. */
  postReturn: number | null;
  beat: boolean | null;
}

export interface DriftAnalysis {
  reactions: EarningsReaction[];
  pre: DriftWindow;
  reaction: DriftWindow;
  post: DriftWindow;
  /** Post-report drift split by whether the quarter beat or missed. */
  postAfterBeat: DriftWindow;
  postAfterMiss: DriftWindow;
  /** Average absolute move on the reaction day — the market's own expectation. */
  typicalMove: number;
  verdict: string;
}

const PRE_DAYS = 5;
const POST_DAYS = 10;

/** Index of the last bar at or before `t`. */
function indexAt(candles: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function pctChange(from: number, to: number): number | null {
  return from > 0 ? ((to - from) / from) * 100 : null;
}

function summarise(values: (number | null)[], days: number): DriftWindow {
  const clean = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (clean.length === 0) return { days, meanReturn: 0, hitRate: 0, samples: 0 };
  return {
    days,
    meanReturn: clean.reduce((s, v) => s + v, 0) / clean.length,
    hitRate: clean.filter((v) => v > 0).length / clean.length,
    samples: clean.length,
  };
}

/**
 * Align earnings dates to the price series and measure the windows around
 * each. Reports whose windows fall outside the loaded history are skipped
 * rather than truncated, so a partial window never masquerades as a full one.
 */
export function analyseDrift(
  earnings: readonly EarningsPoint[],
  candles: readonly Candle[],
): DriftAnalysis | null {
  if (candles.length < 30 || earnings.length === 0) return null;

  const reactions: EarningsReaction[] = [];

  for (const report of earnings) {
    if (report.reportedAt == null) continue;

    const idx = indexAt(candles, report.reportedAt);
    // Needs a full window on both sides to be comparable.
    if (idx < PRE_DAYS || idx + POST_DAYS >= candles.length) continue;

    const preStart = candles[idx - PRE_DAYS]!.c;
    const reportClose = candles[idx]!.c;
    const nextClose = candles[idx + 1]?.c;
    const postEnd = candles[idx + POST_DAYS]!.c;

    reactions.push({
      period: report.period,
      reportedAt: report.reportedAt,
      epsActual: report.epsActual,
      epsEstimate: report.epsEstimate,
      surprisePercent: report.surprisePercent,
      preReturn: pctChange(preStart, reportClose),
      reactionReturn: nextClose != null ? pctChange(reportClose, nextClose) : null,
      // Measured from the day after the report, so the gap itself is not
      // double-counted in the drift.
      postReturn: nextClose != null ? pctChange(nextClose, postEnd) : null,
      beat:
        report.surprisePercent != null
          ? report.surprisePercent > 0
          : report.epsActual != null && report.epsEstimate != null
            ? report.epsActual > report.epsEstimate
            : null,
    });
  }

  if (reactions.length === 0) return null;

  const beats = reactions.filter((r) => r.beat === true);
  const misses = reactions.filter((r) => r.beat === false);

  const reactionMoves = reactions
    .map((r) => r.reactionReturn)
    .filter((v): v is number => v != null);

  const pre = summarise(reactions.map((r) => r.preReturn), PRE_DAYS);
  const reaction = summarise(reactionMoves, 1);
  const post = summarise(reactions.map((r) => r.postReturn), POST_DAYS);
  const postAfterBeat = summarise(beats.map((r) => r.postReturn), POST_DAYS);
  const postAfterMiss = summarise(misses.map((r) => r.postReturn), POST_DAYS);

  const typicalMove =
    reactionMoves.length > 0
      ? reactionMoves.reduce((s, v) => s + Math.abs(v), 0) / reactionMoves.length
      : 0;

  return {
    reactions: reactions.sort((a, b) => b.reportedAt - a.reportedAt),
    pre,
    reaction,
    post,
    postAfterBeat,
    postAfterMiss,
    typicalMove,
    verdict: verdictFor(reactions.length, typicalMove, postAfterBeat, postAfterMiss),
  };
}

function verdictFor(
  samples: number,
  typicalMove: number,
  afterBeat: DriftWindow,
  afterMiss: DriftWindow,
): string {
  if (samples < 3) {
    return `Only ${samples} report${samples === 1 ? "" : "s"} fall inside the loaded history — far too few to read a pattern from. Try a longer range.`;
  }

  const move = `The average move on the session after results is ${typicalMove.toFixed(1)}%.`;

  // Drift is only interesting when beats and misses actually diverge.
  if (afterBeat.samples >= 2 && afterMiss.samples >= 2) {
    const spread = afterBeat.meanReturn - afterMiss.meanReturn;
    if (spread > 3) {
      return `${move} Over ${samples} reports, quarters that beat drifted ${afterBeat.meanReturn.toFixed(1)}% in the following fortnight while misses returned ${afterMiss.meanReturn.toFixed(1)}% — the classic drift pattern, on a small sample.`;
    }
    if (spread < -3) {
      return `${move} Unusually, this name has faded after beats and recovered after misses over these ${samples} reports — the opposite of the textbook pattern, and worth treating as noise until it repeats.`;
    }
    return `${move} Beats and misses have been followed by similar returns here, so the surprise itself has carried little information over these ${samples} reports.`;
  }

  return `${move} Based on ${samples} report${samples === 1 ? "" : "s"} inside the loaded history.`;
}
