"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";

import type { Candle } from "@/lib/twelvedata/types";
import { runBacktest, STRATEGIES, type StrategyId } from "@/lib/analytics/backtest";
import { usePersonal } from "@/lib/store/personal";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { Badge, EmptyState, Panel, PanelHeader, Segmented, Tooltip } from "@/components/ui/primitives";
import { IconChart } from "@/components/ui/icons";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Strategy testing.
 *
 * Takes a rule you can already see on the chart, runs it over the visible
 * history, and shows what it would have done against simply holding.
 *
 * The comparison against buy-and-hold is the point. A rule that returned 30%
 * over a period the stock returned 45% lost money in every sense that counts,
 * and a tool that reports only the first number is flattering you.
 */
export function BacktestPanel({
  candles,
  symbol,
  periodsPerYear,
  className,
}: {
  candles: Candle[];
  symbol: string;
  periodsPerYear: number;
  className?: string;
}) {
  const [strategy, setStrategy] = useState<StrategyId>("ema-cross");
  const { preferences } = usePersonal();

  useThemeVersion();
  const palette = chartPalette();

  const result = useMemo(
    () =>
      runBacktest(strategy, candles, {
        costBps: preferences.backtestCostBps,
        periodsPerYear,
        riskFreeRate: preferences.riskFreeRate / 100,
      }),
    [strategy, candles, preferences.backtestCostBps, preferences.riskFreeRate, periodsPerYear],
  );

  const spec = STRATEGIES.find((s) => s.id === strategy)!;

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Strategy test"
        subtitle={`${spec.label} on ${symbol}, against simply holding`}
        action={
          result && (
            <Badge tone={result.alpha > 0 ? "up" : result.alpha < 0 ? "down" : "neutral"}>
              {result.alpha >= 0 ? "+" : ""}
              {result.alpha.toFixed(1)} pts vs holding
            </Badge>
          )
        }
      />

      <div className="scroll-x flex gap-1.5 border-b border-line px-4 py-3">
        {STRATEGIES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStrategy(s.id)}
            title={s.description}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-sm border px-2.5 py-1.5 text-[11px] transition-colors duration-150",
              strategy === s.id
                ? "border-signal/50 bg-signal/[0.08] text-ivory"
                : "border-line text-ivory-60 hover:border-line-bright hover:text-ivory",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {!result ? (
        <EmptyState
          icon={<IconChart />}
          title="Not enough history"
          description="Switch to a longer range — a meaningful test needs at least sixty bars, and the slower rules need several hundred."
        />
      ) : (
        <>
          <div className="p-4">
            <p className="mb-3 text-[12px] leading-relaxed text-ivory-60">{spec.premise}</p>
            <EquityCurve result={result} palette={palette} />
          </div>

          <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Strategy return"
              value={formatPercent(result.totalReturn)}
              tone={result.totalReturn}
            />
            <Metric
              label="Buy and hold"
              value={formatPercent(result.benchmarkReturn)}
              tone={result.benchmarkReturn}
              dim
            />
            <Metric
              label="Max drawdown"
              value={`−${result.maxDrawdown.toFixed(1)}%`}
              tone={-1}
              hint={`Holding drew down ${result.benchmarkMaxDrawdown.toFixed(1)}% over the same window.`}
            />
            <Metric
              label="Sharpe"
              value={result.sharpe.toFixed(2)}
              tone={result.sharpe}
              hint="Return per unit of volatility. Above 1 is respectable; above 2 is rare and usually means something is wrong with the test."
            />
          </div>

          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Trades" value={String(result.tradeCount)} />
            <Metric
              label="Win rate"
              value={`${result.winRate.toFixed(0)}%`}
              hint="A high win rate with a low profit factor means many small wins and a few large losses."
            />
            <Metric
              label="Profit factor"
              value={Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "∞"}
              tone={result.profitFactor > 1 ? 1 : -1}
              hint="Gross profit divided by gross loss. Below 1 loses money."
            />
            <Metric
              label="Time in market"
              value={`${result.exposure.toFixed(0)}%`}
              hint="Share of the period actually holding a position. Low exposure with similar returns is a better risk profile."
            />
          </div>

          <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ivory-60">
            {result.verdict}
          </p>

          <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
            Signals are executed at the next bar's open, never the close that generated them,
            and each side pays {preferences.backtestCostBps} basis points. One rule on one
            instrument over one window is an observation, not evidence.
          </p>
        </>
      )}
    </Panel>
  );
}

function EquityCurve({
  result,
  palette,
}: {
  result: NonNullable<ReturnType<typeof runBacktest>>;
  palette: ReturnType<typeof chartPalette>;
}) {
  const W = 860;
  const H = 190;
  const PAD = { top: 10, right: 6, bottom: 14, left: 6 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const all = [...result.equity, ...result.benchmark];
  const min = Math.min(...all) * 0.98;
  const max = Math.max(...all) * 1.02;

  const x = (i: number) => PAD.left + (i / (result.equity.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

  const path = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const outperforming = result.alpha >= 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[190px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Strategy equity curve against buy and hold"
      >
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={y(100)}
          y2={y(100)}
          stroke={palette.axis}
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {/* Holding is the reference, so it is drawn quieter and underneath. */}
        <path d={path(result.benchmark)} fill="none" stroke={palette.textDim} strokeWidth={1.2} />

        <motion.path
          d={path(result.equity)}
          fill="none"
          stroke={outperforming ? palette.up : palette.down}
          strokeWidth={1.8}
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>

      <div className="mt-2 flex items-center gap-4 text-[10px] text-ivory-40">
        <span className="flex items-center gap-1.5">
          <span
            className="h-[2px] w-4 rounded-full"
            style={{ backgroundColor: outperforming ? palette.up : palette.down }}
          />
          Strategy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-4 rounded-full" style={{ backgroundColor: palette.textDim }} />
          Buy and hold
        </span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
  dim,
}: {
  label: string;
  value: string;
  tone?: number;
  hint?: string;
  dim?: boolean;
}) {
  const body = (
    <div className="bg-ink-900 p-4">
      <p
        className={cn(
          "label-micro text-ivory-40",
          hint && "cursor-help border-b border-dotted border-line-strong inline-block",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "num-mono mt-2.5 text-[17px] leading-none tracking-tight",
          tone == null
            ? dim
              ? "text-ivory-60"
              : "text-ivory"
            : tone > 0
              ? "text-up"
              : tone < 0
                ? "text-down"
                : "text-ivory",
        )}
      >
        {value}
      </p>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
