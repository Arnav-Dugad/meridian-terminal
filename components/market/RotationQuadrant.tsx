"use client";

import { useMemo } from "react";
import { motion } from "motion/react";

import type { SectorAggregate } from "@/lib/twelvedata/types";
import { SECTOR_HUE } from "@/lib/market/universe";
import { Panel, PanelHeader, Tooltip, EmptyState } from "@/components/ui/primitives";
import { IconScale } from "@/components/ui/icons";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sector rotation.
 *
 * Two axes, four quadrants — the relative-rotation view institutional desks
 * use, which says something a ranked bar chart cannot: not just which sectors
 * are strong, but which are *becoming* strong.
 *
 *   x  relative strength — how far the sector is ahead of the market
 *   y  momentum — whether that lead is widening or narrowing
 *
 * Read clockwise from the top right: leading sectors lose momentum and become
 * weakening, weakening becomes lagging, lagging picks up momentum and becomes
 * improving, and improving becomes leading. A sector in the improving quadrant
 * is still behind the market but closing, which is the earliest thing this
 * view can tell you.
 *
 * Both axes come from figures already computed for the rotation panel, so this
 * costs nothing beyond the arithmetic.
 */

interface Point {
  sector: string;
  /** Percentage points ahead of the market's own move. */
  relative: number;
  /** Breadth within the sector, recentred to −1…1 — the momentum proxy. */
  momentum: number;
  changePercent: number;
  count: number;
  colour: string;
}

export function RotationQuadrant({
  sectors,
  marketChange,
  regionLabel,
  className,
}: {
  sectors: SectorAggregate[];
  /** The market's own cap-weighted move, as the benchmark. */
  marketChange: number;
  regionLabel: string;
  className?: string;
}) {
  useThemeVersion();
  const palette = chartPalette();

  const points = useMemo<Point[]>(
    () =>
      sectors
        .filter((s) => s.count > 0)
        .map((s) => ({
          sector: s.sector,
          relative: s.changePercent - marketChange,
          // Advancing share recentred: 1.0 means every name in the sector is
          // up, −1.0 means every name is down. A sector can be down overall
          // while most of its constituents rise, and that divergence is
          // precisely what momentum is meant to catch.
          momentum: (s.advancing / Math.max(1, s.count)) * 2 - 1,
          changePercent: s.changePercent,
          count: s.count,
          colour: SECTOR_HUE[s.sector as keyof typeof SECTOR_HUE] ?? "#8f9bb3",
        })),
    [sectors, marketChange],
  );

  if (points.length < 3) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Sector rotation" subtitle="Relative strength against momentum" />
        <EmptyState
          icon={<IconScale />}
          title="Not enough sector coverage"
          description="This needs several sectors priced at once. It fills in when the market data sources are responding."
        />
      </Panel>
    );
  }

  const W = 640;
  const H = 420;
  const PAD = 34;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  // Symmetric extents so the origin sits dead centre; an off-centre origin
  // would make the quadrants lie about which one a point is in.
  const xExtent = Math.max(0.6, ...points.map((p) => Math.abs(p.relative))) * 1.2;
  const yExtent = 1.05;

  const x = (v: number) => PAD + ((v + xExtent) / (xExtent * 2)) * plotW;
  const y = (v: number) => PAD + (1 - (v + yExtent) / (yExtent * 2)) * plotH;

  const cx = x(0);
  const cy = y(0);

  const QUADRANTS = [
    { label: "Leading", x: cx + plotW * 0.22, y: cy - plotH * 0.34, tone: palette.up },
    { label: "Weakening", x: cx + plotW * 0.22, y: cy + plotH * 0.34, tone: palette.textDim },
    { label: "Lagging", x: cx - plotW * 0.22, y: cy + plotH * 0.34, tone: palette.down },
    { label: "Improving", x: cx - plotW * 0.22, y: cy - plotH * 0.34, tone: palette.textDim },
  ];

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Sector rotation"
        subtitle={`${regionLabel} — position is strength against the market, height is participation`}
      />

      <div className="p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Sector rotation quadrant"
        >
          {/* Quadrant tints, faint enough to read labels over. */}
          <rect x={cx} y={PAD} width={PAD + plotW - cx} height={cy - PAD} fill={palette.up} opacity={0.035} />
          <rect x={PAD} y={cy} width={cx - PAD} height={PAD + plotH - cy} fill={palette.down} opacity={0.035} />

          {QUADRANTS.map((q) => (
            <text
              key={q.label}
              x={q.x}
              y={q.y}
              fill={q.tone}
              opacity={0.5}
              fontSize={11}
              fontFamily="var(--font-plex-mono), monospace"
              textAnchor="middle"
              letterSpacing="0.12em"
            >
              {q.label.toUpperCase()}
            </text>
          ))}

          {/* Axes through the origin. */}
          <line x1={PAD} x2={PAD + plotW} y1={cy} y2={cy} stroke={palette.axis} strokeWidth={1} />
          <line x1={cx} x2={cx} y1={PAD} y2={PAD + plotH} stroke={palette.axis} strokeWidth={1} />

          <text x={PAD + plotW} y={cy - 8} fill={palette.textDim} fontSize={9} textAnchor="end" letterSpacing="0.1em">
            AHEAD OF MARKET →
          </text>
          <text x={cx + 8} y={PAD + 4} fill={palette.textDim} fontSize={9} letterSpacing="0.1em">
            ↑ BROAD PARTICIPATION
          </text>

          {points.map((p, i) => {
            // Size by constituent count, square-rooted so area tracks weight.
            const r = 6 + Math.sqrt(p.count) * 1.9;
            return (
              <motion.g
                key={p.sector}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: `${x(p.relative)}px ${y(p.momentum)}px` }}
              >
                <circle
                  cx={x(p.relative)}
                  cy={y(p.momentum)}
                  r={r + 4}
                  fill={p.colour}
                  opacity={0.13}
                />
                <circle
                  cx={x(p.relative)}
                  cy={y(p.momentum)}
                  r={r}
                  fill={p.colour}
                  opacity={0.78}
                  stroke={palette.surface}
                  strokeWidth={1.5}
                />
                <text
                  x={x(p.relative)}
                  y={y(p.momentum) + r + 11}
                  fill={palette.text}
                  fontSize={9}
                  fontFamily="var(--font-plex-mono), monospace"
                  textAnchor="middle"
                >
                  {p.sector.slice(0, 11)}
                </text>
              </motion.g>
            );
          })}
        </svg>
      </div>

      {/* A readable list beside the plot, since a scatter alone is hard to scan. */}
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
        {points
          .slice()
          .sort((a, b) => b.relative - a.relative)
          .slice(0, 6)
          .map((p) => (
            <div key={p.sector} className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: p.colour }} />
                <span className="truncate text-[11px] text-ivory-80">{p.sector}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Tooltip content="How far ahead of, or behind, the market's own move.">
                  <span
                    className={cn(
                      "num-mono cursor-help text-[11px]",
                      p.relative >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {formatPercent(p.relative)}
                  </span>
                </Tooltip>
                <span className="num-mono w-[46px] text-right text-[10px] text-ivory-40">
                  {quadrantOf(p)}
                </span>
              </span>
            </div>
          ))}
      </div>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Sectors rotate clockwise: leading loses momentum and weakens, weakening falls behind,
        lagging picks up participation and improves, improving becomes leading. A sector in
        the improving quadrant is still behind the market but closing — the earliest thing
        this view can show you.
      </p>
    </Panel>
  );
}

function quadrantOf(p: Point): string {
  if (p.relative >= 0) return p.momentum >= 0 ? "lead" : "weaken";
  return p.momentum >= 0 ? "improve" : "lag";
}
