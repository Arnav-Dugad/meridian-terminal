"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

import type { Candle } from "@/lib/twelvedata/types";
import type { EarningsPoint } from "@/lib/providers/types";
import { analyseDrift, type DriftWindow } from "@/lib/analytics/drift";
import { EmptyState, Panel, PanelHeader, Skeleton, Tooltip, Badge } from "@/components/ui/primitives";
import { IconClock } from "@/components/ui/icons";
import { formatDate, formatPercent } from "@/lib/format";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { cn } from "@/lib/utils";

/**
 * How this name behaves around results.
 *
 * Post-earnings drift is one of the few effects in equities that has survived
 * decades of testing: stocks that beat keep drifting up, stocks that miss keep
 * drifting down. Whether it holds for *this* name is an empirical question,
 * and the price series on the client already contains the answer.
 */
export function DriftPanel({
  earnings,
  candles,
  loading,
  className,
}: {
  earnings: EarningsPoint[];
  candles: Candle[];
  loading: boolean;
  className?: string;
}) {
  useThemeVersion();
  const palette = chartPalette();

  const analysis = useMemo(() => analyseDrift(earnings, candles), [earnings, candles]);

  if (loading) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Behaviour around results" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Panel>
    );
  }

  if (!analysis) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Behaviour around results" />
        <EmptyState
          icon={<IconClock />}
          title="Not enough overlap"
          description="This needs past report dates and price history covering them. Switch to a 1Y or 5Y range and it will fill in."
        />
      </Panel>
    );
  }

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Behaviour around results"
        subtitle={`Measured across ${analysis.reactions.length} past report${analysis.reactions.length === 1 ? "" : "s"}`}
        action={
          <Tooltip content="Average absolute move on the session after results. The options market usually prices something close to this.">
            <Badge tone="signal">±{analysis.typicalMove.toFixed(1)}% typical</Badge>
          </Tooltip>
        }
      />

      {/* The three windows */}
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <WindowCell
          label="Run-up"
          sub="5 sessions before"
          window={analysis.pre}
          hint="How the stock moves into the report. A strong run-up raises the bar the results have to clear."
        />
        <WindowCell
          label="Reaction"
          sub="First session after"
          window={analysis.reaction}
          hint="The gap on the day. This is the part everyone watches, and the part that is hardest to trade."
          emphasise
        />
        <WindowCell
          label="Drift"
          sub="10 sessions after"
          window={analysis.post}
          hint="What happens once the dust settles. This is where post-earnings drift shows up, if it shows up."
        />
      </div>

      {/* Beat versus miss */}
      {analysis.postAfterBeat.samples > 0 && analysis.postAfterMiss.samples > 0 && (
        <div className="border-t border-line p-4">
          <p className="label-micro mb-3 text-ivory-40">Drift, split by beat or miss</p>
          <div className="space-y-2.5">
            <SplitBar
              label="After a beat"
              value={analysis.postAfterBeat.meanReturn}
              samples={analysis.postAfterBeat.samples}
              extent={Math.max(
                Math.abs(analysis.postAfterBeat.meanReturn),
                Math.abs(analysis.postAfterMiss.meanReturn),
                2,
              )}
              palette={palette}
            />
            <SplitBar
              label="After a miss"
              value={analysis.postAfterMiss.meanReturn}
              samples={analysis.postAfterMiss.samples}
              extent={Math.max(
                Math.abs(analysis.postAfterBeat.meanReturn),
                Math.abs(analysis.postAfterMiss.meanReturn),
                2,
              )}
              palette={palette}
            />
          </div>
        </div>
      )}

      <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ivory-60">
        {analysis.verdict}
      </p>

      {/* Report-by-report */}
      <div className="table-scroll border-t border-line">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              {["Quarter", "Surprise", "Run-up", "Reaction", "Drift"].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    "label-micro px-4 py-2.5 font-medium text-ivory-40",
                    i === 0 ? "text-left" : "text-right",
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.reactions.map((r, i) => (
              <motion.tr
                key={`${r.period}-${r.reportedAt}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                className="border-b border-line/60 hover:bg-ink-850"
              >
                <td className="px-4 py-2.5">
                  <span className="num-mono text-[11px] text-ivory">{formatDate(r.reportedAt)}</span>
                  {r.beat != null && (
                    <span
                      className={cn(
                        "label-micro-tight ml-2 rounded-[3px] px-1.5 py-px",
                        r.beat ? "bg-up/12 text-up" : "bg-down/12 text-down",
                      )}
                    >
                      {r.beat ? "beat" : "miss"}
                    </span>
                  )}
                </td>
                <Cell value={r.surprisePercent} decimals={1} />
                <Cell value={r.preReturn} />
                <Cell value={r.reactionReturn} bold />
                <Cell value={r.postReturn} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Windows are measured in trading sessions. Drift starts the day after the reaction,
        so the gap itself is not counted twice. A handful of reports is a small sample —
        read this as a description of what happened, not a prediction.
      </p>
    </Panel>
  );
}

function Cell({ value, decimals = 2, bold }: { value: number | null; decimals?: number; bold?: boolean }) {
  return (
    <td
      className={cn(
        "num-mono px-4 py-2.5 text-right text-[11px]",
        value == null ? "text-ivory-40" : value > 0 ? "text-up" : "text-down",
        bold && "font-medium",
      )}
    >
      {value != null ? formatPercent(value, { decimals }) : "—"}
    </td>
  );
}

function WindowCell({
  label,
  sub,
  window,
  hint,
  emphasise,
}: {
  label: string;
  sub: string;
  window: DriftWindow;
  hint: string;
  emphasise?: boolean;
}) {
  return (
    <div className="bg-ink-900 p-4">
      <Tooltip content={hint}>
        <p className="label-micro cursor-help border-b border-dotted border-line-strong text-ivory-40">
          {label}
        </p>
      </Tooltip>
      <p className="label-micro-tight mt-1 text-ivory-25">{sub}</p>

      <p
        className={cn(
          "num-mono mt-3 leading-none tracking-tight",
          emphasise ? "text-[24px]" : "text-[20px]",
          window.meanReturn > 0 ? "text-up" : window.meanReturn < 0 ? "text-down" : "text-ivory",
        )}
      >
        {formatPercent(window.meanReturn)}
      </p>

      {/* Hit rate is the honest companion to a mean: +4% on a 40% hit rate is
          one outlier, not a tendency. */}
      <div className="mt-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
          <motion.div
            className={cn("h-full rounded-full", window.hitRate >= 0.5 ? "bg-up/70" : "bg-down/70")}
            initial={{ width: 0 }}
            animate={{ width: `${window.hitRate * 100}%` }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-ivory-40">
          positive {(window.hitRate * 100).toFixed(0)}% of the time · {window.samples} sample
          {window.samples === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

function SplitBar({
  label,
  value,
  samples,
  extent,
  palette,
}: {
  label: string;
  value: number;
  samples: number;
  extent: number;
  palette: ReturnType<typeof chartPalette>;
}) {
  const magnitude = Math.min(1, Math.abs(value) / extent);
  const positive = value >= 0;

  return (
    <div className="flex items-center gap-3">
      <span className="w-[96px] shrink-0 text-[11px] text-ivory-60">{label}</span>

      <div className="relative h-3.5 flex-1">
        <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong" />
        <motion.span
          className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-[1px]"
          style={{
            backgroundColor: positive ? palette.up : palette.down,
            opacity: 0.8,
            ...(positive ? { left: "50%" } : { right: "50%" }),
          }}
          initial={{ width: 0 }}
          animate={{ width: `${magnitude * 50}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <span
        className={cn("num-mono w-[58px] shrink-0 text-right text-[11px]", positive ? "text-up" : "text-down")}
      >
        {formatPercent(value, { decimals: 1 })}
      </span>
      <span className="w-[28px] shrink-0 text-right text-[10px] text-ivory-40">n={samples}</span>
    </div>
  );
}
