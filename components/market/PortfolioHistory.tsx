"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

import type { PortfolioSnapshot } from "@/lib/store/types";
import type { Currency } from "@/lib/format";
import { formatCompactMoney, formatDate, formatPercent, formatPrice } from "@/lib/format";
import { EmptyState, Panel, PanelHeader, Badge } from "@/components/ui/primitives";
import { IconChart } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";

/**
 * Book value over time.
 *
 * A portfolio page without history answers "what do I hold" but not "is it
 * working" — and the second question is the one people actually open a
 * portfolio to ask. Each day the page is opened writes one small snapshot
 * document keyed by date, so the curve builds itself with no scheduled job and
 * no duplicate rows.
 *
 * Cost basis is drawn alongside value, because the gap between the two *is*
 * the P&L, and showing it as an area makes a losing period unmistakable in a
 * way a single line does not.
 */
export function PortfolioHistory({
  snapshots,
  baseCurrency,
  className,
}: {
  snapshots: PortfolioSnapshot[];
  baseCurrency: Currency;
  className?: string;
}) {
  useThemeVersion();
  const palette = chartPalette();

  const model = useMemo(() => {
    // Currency is stored per snapshot, so switching base currency must not
    // silently plot rupees against dollars on one axis.
    const usable = snapshots.filter((s) => s.baseCurrency === baseCurrency && s.value > 0);
    if (usable.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const s of usable) {
      min = Math.min(min, s.value, s.cost);
      max = Math.max(max, s.value, s.cost);
    }
    const pad = (max - min) * 0.12 || Math.max(max * 0.05, 1);
    min = Math.max(0, min - pad);
    max += pad;

    const first = usable[0]!;
    const last = usable[usable.length - 1]!;

    return {
      points: usable,
      min,
      max,
      first,
      last,
      totalReturn: first.value > 0 ? ((last.value - first.value) / first.value) * 100 : 0,
      days: usable.length,
    };
  }, [snapshots, baseCurrency]);

  if (!model) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Book value over time" subtitle="Builds as you use the terminal" />
        <EmptyState
          icon={<IconChart />}
          title="Not enough history yet"
          description="A snapshot of your book is recorded each day you open this page. Come back tomorrow and the curve starts; it needs two days to draw."
        />
      </Panel>
    );
  }

  const W = 800;
  const H = 200;
  const PAD = { top: 12, right: 8, bottom: 20, left: 8 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (model.points.length === 1 ? plotW / 2 : (i / (model.points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - model.min) / (model.max - model.min)) * plotH;

  const valuePath = model.points.map((s, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(s.value).toFixed(1)}`).join(" ");
  const costPath = model.points.map((s, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(s.cost).toFixed(1)}`).join(" ");

  // Fill between value and cost — the shaded band is unrealised P&L.
  const areaPath = `${valuePath} ${model.points
    .slice()
    .reverse()
    .map((s, ri) => `L ${x(model.points.length - 1 - ri).toFixed(1)} ${y(s.cost).toFixed(1)}`)
    .join(" ")} Z`;

  const up = model.last.value >= model.last.cost;

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Book value over time"
        subtitle={`${model.days} day${model.days === 1 ? "" : "s"} recorded`}
        action={
          <Badge tone={model.totalReturn >= 0 ? "up" : "down"}>
            {formatPercent(model.totalReturn)} since {formatDate(model.first.date)}
          </Badge>
        }
      />

      <div className="p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[200px] w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Portfolio value from ${model.first.date} to ${model.last.date}`}
        >
          <defs>
            <linearGradient id="pnl-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={up ? palette.up : palette.down} stopOpacity={0.22} />
              <stop offset="100%" stopColor={up ? palette.up : palette.down} stopOpacity={0.04} />
            </linearGradient>
          </defs>

          <motion.path
            d={areaPath}
            fill="url(#pnl-band)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          />

          {/* Cost basis: dashed, because it is a reference not a series. */}
          <path
            d={costPath}
            fill="none"
            stroke={palette.textDim}
            strokeWidth={1.2}
            strokeDasharray="3 4"
          />

          <motion.path
            d={valuePath}
            fill="none"
            stroke={up ? palette.up : palette.down}
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />

          <circle
            cx={x(model.points.length - 1)}
            cy={y(model.last.value)}
            r={3.5}
            fill={up ? palette.up : palette.down}
            stroke={palette.surface}
            strokeWidth={1.5}
          />
        </svg>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
          <Stat label="Value now" value={formatPrice(model.last.value, baseCurrency)} />
          <Stat label="Cost basis" value={formatPrice(model.last.cost, baseCurrency)} dim />
          <Stat
            label="Unrealised"
            value={formatCompactMoney(model.last.pnl, baseCurrency)}
            tone={model.last.pnl}
          />
          <Stat
            label="Since first record"
            value={formatPercent(model.totalReturn)}
            tone={model.totalReturn}
          />
        </dl>

        <p className="mt-3 text-[11px] leading-relaxed text-ivory-40">
          The shaded band is the gap between market value and cost basis. Snapshots are
          recorded once per day, on days you open this page — so gaps are days the terminal
          was not used, not days the market was closed.
        </p>
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
  dim,
}: {
  label: string;
  value: string;
  tone?: number;
  dim?: boolean;
}) {
  return (
    <div>
      <dt className="label-micro text-ivory-40">{label}</dt>
      <dd
        className={cn(
          "num-mono mt-1.5 text-[13px]",
          tone != null && tone > 0
            ? "text-up"
            : tone != null && tone < 0
              ? "text-down"
              : dim
                ? "text-ivory-60"
                : "text-ivory",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
