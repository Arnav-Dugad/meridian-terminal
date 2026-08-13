"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

import type { Candle } from "@/lib/twelvedata/types";
import { analyseSeasonality, type MonthStat } from "@/lib/analytics/seasonality";
import { EmptyState, Panel, PanelHeader, Tooltip, Badge } from "@/components/ui/primitives";
import { IconClock } from "@/components/ui/icons";
import { formatPercent } from "@/lib/format";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { cn } from "@/lib/utils";

/**
 * Seasonality.
 *
 * Two views of the same data: a month-by-year grid showing every observation,
 * and an averages row underneath. The grid is the important half — it makes
 * visible whether a "strong month" is a consistent tendency or one enormous
 * year dragging an average around, which a bar chart of means would hide
 * completely.
 *
 * Costs nothing: it runs on candles already loaded for the chart.
 */
export function SeasonalityPanel({
  candles,
  symbol,
  className,
}: {
  candles: Candle[];
  symbol: string;
  className?: string;
}) {
  useThemeVersion();
  const palette = chartPalette();

  const analysis = useMemo(() => analyseSeasonality(candles), [candles]);

  if (!analysis) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Seasonality" subtitle="Month-by-month behaviour" />
        <EmptyState
          icon={<IconClock />}
          title="Needs more history"
          description="Switch the chart to 5Y or Max and this fills in. Monthly patterns need several years before they say anything at all."
        />
      </Panel>
    );
  }

  // A cell's colour is scaled against the largest monthly *mean*, not the
  // largest single observation, so one crash does not wash out the whole grid.
  const cellExtent = Math.max(6, analysis.extent * 2.4);

  const byYear = new Map<number, Map<number, number>>();
  for (const cell of analysis.cells) {
    let row = byYear.get(cell.year);
    if (!row) {
      row = new Map();
      byYear.set(cell.year, row);
    }
    row.set(cell.month, cell.value);
  }

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Seasonality"
        subtitle={`${symbol} by calendar month, ${analysis.totalYears} years`}
        action={
          analysis.bestMonth &&
          analysis.bestMonth.years >= 3 && (
            <Badge tone="up">
              {analysis.bestMonth.label} strongest
            </Badge>
          )
        }
      />

      <div className="table-scroll p-4">
        <table className="w-full min-w-[620px] border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th className="label-micro w-[46px] pb-1.5 text-left font-medium text-ivory-40">
                Year
              </th>
              {analysis.months.map((m) => (
                <th key={m.month} className="label-micro pb-1.5 font-medium text-ivory-40">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {analysis.years.slice(0, 12).map((year, rowIndex) => {
              const row = byYear.get(year);
              return (
                <tr key={year}>
                  <td className="num-mono pr-1 text-[10px] text-ivory-60">{year}</td>
                  {analysis.months.map((m) => {
                    const value = row?.get(m.month);
                    return (
                      <td key={m.month} className="p-0">
                        {value == null ? (
                          <span className="block h-6 rounded-[2px] bg-ink-850" />
                        ) : (
                          <Tooltip
                            content={`${m.label} ${year}: ${formatPercent(value)}`}
                            side={rowIndex < 2 ? "bottom" : "top"}
                          >
                            <motion.span
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{
                                duration: 0.28,
                                delay: Math.min((rowIndex * 12 + m.month) * 0.004, 0.4),
                              }}
                              className="num-mono flex h-6 w-full cursor-help items-center justify-center rounded-[2px] text-[9px]"
                              style={{
                                backgroundColor: cellColour(value, cellExtent, palette),
                                color:
                                  Math.abs(value) / cellExtent > 0.5 ? "#ffffff" : palette.textDim,
                              }}
                            >
                              {value.toFixed(0)}
                            </motion.span>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* The averages row, visually separated from the observations. */}
            <tr>
              <td colSpan={13} className="pt-2" />
            </tr>
            <tr>
              <td className="label-micro pr-1 text-[9px] text-ivory-40">Avg</td>
              {analysis.months.map((m) => (
                <td key={m.month} className="p-0">
                  <MonthCell stat={m} extent={analysis.extent} palette={palette} />
                </td>
              ))}
            </tr>
            <tr>
              <td className="label-micro pr-1 text-[9px] text-ivory-40">Hit</td>
              {analysis.months.map((m) => (
                <td key={m.month} className="p-0">
                  <span
                    className={cn(
                      "num-mono flex h-5 items-center justify-center text-[9px]",
                      m.hitRate >= 0.6
                        ? "text-up"
                        : m.hitRate <= 0.4 && m.years > 0
                          ? "text-down"
                          : "text-ivory-40",
                    )}
                  >
                    {m.years > 0 ? `${(m.hitRate * 100).toFixed(0)}%` : "—"}
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ivory-60">
        {analysis.verdict}
      </p>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Each cell is that month's close-to-close return. The bottom two rows are the
        average across years and how often the month closed positive — read them together,
        because a strong average on a coin-flip hit rate is one outlier year, not a
        tendency.
      </p>
    </Panel>
  );
}

function MonthCell({
  stat,
  extent,
  palette,
}: {
  stat: MonthStat;
  extent: number;
  palette: ReturnType<typeof chartPalette>;
}) {
  if (stat.years === 0) {
    return <span className="block h-6 rounded-[2px] bg-ink-850" />;
  }

  return (
    <Tooltip
      content={
        <span>
          <strong>{stat.label}</strong> over {stat.years} year{stat.years === 1 ? "" : "s"}
          <br />
          Mean {formatPercent(stat.meanReturn)} · median {formatPercent(stat.medianReturn)}
          <br />
          Positive {(stat.hitRate * 100).toFixed(0)}% of years
          {stat.best && (
            <>
              <br />
              Best {stat.best.year}: {formatPercent(stat.best.value)}
            </>
          )}
          {stat.worst && (
            <>
              <br />
              Worst {stat.worst.year}: {formatPercent(stat.worst.value)}
            </>
          )}
        </span>
      }
    >
      <span
        className="num-mono flex h-6 w-full cursor-help items-center justify-center rounded-[2px] text-[9px] font-medium"
        style={{
          backgroundColor: cellColour(stat.meanReturn, extent, palette),
          color: Math.abs(stat.meanReturn) / extent > 0.5 ? "#ffffff" : palette.textDim,
        }}
      >
        {stat.meanReturn.toFixed(1)}
      </span>
    </Tooltip>
  );
}

/** Diverging ramp from the theme's own up/down colours, centred on zero. */
function cellColour(
  value: number,
  extent: number,
  palette: ReturnType<typeof chartPalette>,
): string {
  const magnitude = Math.min(1, Math.abs(value) / extent);
  const base = value >= 0 ? palette.up : palette.down;
  const rgb = toRgb(base);
  // Floor the alpha so a near-zero month is still a visible tile rather than
  // an apparent gap in the grid.
  return `rgba(${rgb}, ${0.1 + magnitude * 0.78})`;
}

function toRgb(colour: string): string {
  const hex = colour.trim().replace("#", "");
  if (hex.length === 6) {
    return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`;
  }
  const m = colour.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? `${m[1]}, ${m[2]}, ${m[3]}` : "128, 128, 128";
}
