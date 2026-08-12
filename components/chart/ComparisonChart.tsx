"use client";

import { useId, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import type { Candle } from "@/lib/twelvedata/types";
import { normalise } from "@/lib/analytics/indicators";
import { cn } from "@/lib/utils";

/**
 * Rebased performance overlay.
 *
 * Comparing a ₹1,478 listing with a $232 one on a shared price axis is
 * meaningless; both are rebased to 100 at the left edge so the vertical
 * distance between two lines *is* the difference in return. That is the whole
 * point of the view, and it is why the y-axis is labelled in percent rather
 * than in either currency.
 *
 * SVG rather than canvas: half a dozen polylines is nothing for the
 * compositor, and it buys crisp text, a free draw-on animation via stroke-dash,
 * and hover targets the browser hit-tests for us.
 */

export interface ComparisonSeries {
  slug: string;
  label: string;
  color: string;
  candles: Candle[];
}

const PAD = { top: 16, right: 54, bottom: 24, left: 8 };

export function ComparisonChart({
  series,
  height = 400,
  className,
}: {
  series: ComparisonSeries[];
  height?: number;
  className?: string;
}) {
  const gradientId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ ratio: number; x: number } | null>(null);
  const [width, setWidth] = useState(880);

  // Resample everything onto a common index count so the lines share an
  // x-axis even when the provider returns different bar counts per symbol.
  const model = useMemo(() => {
    const usable = series.filter((s) => s.candles.length > 1);
    if (usable.length === 0) return null;

    const points = Math.min(...usable.map((s) => s.candles.length));
    if (points < 2) return null;

    const lines = usable.map((s) => {
      const closes = s.candles.map((c) => c.c);
      const step = (closes.length - 1) / (points - 1);
      const sampled = Array.from({ length: points }, (_, i) => closes[Math.round(i * step)] ?? 0);
      return { ...s, values: normalise(sampled, 100) };
    });

    let min = Infinity;
    let max = -Infinity;
    for (const line of lines) {
      for (const v of line.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const pad = (max - min) * 0.09 || 4;
    min -= pad;
    max += pad;

    const times = usable[0]!.candles;
    const timeStep = (times.length - 1) / (points - 1);
    const timestamps = Array.from(
      { length: points },
      (_, i) => times[Math.round(i * timeStep)]?.t ?? 0,
    );

    return { lines, min, max, points, timestamps };
  }, [series]);

  // Measure once per layout change; ResizeObserver is overkill for a chart
  // that already re-renders when its data changes.
  const measure = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      const w = node.getBoundingClientRect().width;
      if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
    }
  };

  if (!model) {
    return (
      <div className={cn("flex items-center justify-center", className)} style={{ height }}>
        <p className="label-micro text-ivory-40">Not enough history to compare</p>
      </div>
    );
  }

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);

  const x = (i: number) => PAD.left + (i / (model.points - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - model.min) / (model.max - model.min)) * plotH;

  const hoverIndex =
    hover != null ? Math.max(0, Math.min(model.points - 1, Math.round(hover.ratio * (model.points - 1)))) : null;

  const ticks = niceTicks(model.min, model.max, 5);

  return (
    <div ref={measure} className={cn("relative w-full", className)} style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Rebased performance comparison of ${model.lines.map((l) => l.label).join(", ")}`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          setHover({ ratio: (px - PAD.left) / plotW, x: px });
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4f2ec" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#f4f2ec" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Gridlines and the axis. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(244,242,236,0.055)"
              strokeWidth={1}
            />
            <text
              x={PAD.left + plotW + 8}
              y={y(t)}
              fill="#6a6862"
              fontSize={10}
              fontFamily="var(--font-plex-mono), monospace"
              dominantBaseline="middle"
            >
              {t === 100 ? "0%" : `${t > 100 ? "+" : ""}${(t - 100).toFixed(0)}%`}
            </text>
          </g>
        ))}

        {/* The 100 baseline — where every series started. */}
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={y(100)}
          y2={y(100)}
          stroke="rgba(244,242,236,0.24)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {model.lines.map((line, li) => {
          const d = line.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
          return (
            <g key={line.slug}>
              <motion.path
                d={d}
                fill="none"
                stroke={line.color}
                strokeWidth={1.7}
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.9, delay: li * 0.07, ease: [0.16, 1, 0.3, 1] }}
              />
              {/* Terminal dot, so the eye can find each line's end. */}
              <circle
                cx={x(model.points - 1)}
                cy={y(line.values[line.values.length - 1] ?? 100)}
                r={3}
                fill={line.color}
                stroke="#0b0b0d"
                strokeWidth={1.4}
              />
            </g>
          );
        })}

        {hoverIndex != null && (
          <>
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="rgba(244,242,236,0.3)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            {model.lines.map((line) => (
              <circle
                key={line.slug}
                cx={x(hoverIndex)}
                cy={y(line.values[hoverIndex] ?? 100)}
                r={3.2}
                fill="#0b0b0d"
                stroke={line.color}
                strokeWidth={1.8}
              />
            ))}
          </>
        )}
      </svg>

      {/* Hover read-out. */}
      {hoverIndex != null && (
        <div
          className="pointer-events-none absolute top-3 z-10 w-[186px] rounded-md border border-line-strong bg-ink-850/96 p-2.5 backdrop-blur-sm"
          style={{
            left: Math.min(Math.max(8, (hover?.x ?? 0) + 14), Math.max(8, width - 200)),
          }}
        >
          <p className="label-micro mb-2 text-ivory-60">
            {formatStamp(model.timestamps[hoverIndex] ?? 0)}
          </p>
          <ul className="space-y-1.5">
            {model.lines
              .slice()
              .sort((a, b) => (b.values[hoverIndex] ?? 0) - (a.values[hoverIndex] ?? 0))
              .map((line) => {
                const v = (line.values[hoverIndex] ?? 100) - 100;
                return (
                  <li key={line.slug} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-[1px]"
                        style={{ backgroundColor: line.color }}
                      />
                      <span className="num-mono truncate text-ivory-80">{line.label}</span>
                    </span>
                    <span className={cn("num-mono shrink-0", v >= 0 ? "text-up" : "text-down")}>
                      {v >= 0 ? "+" : ""}
                      {v.toFixed(2)}%
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * magnitude;

  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    out.push(Math.round(v / step) * step);
  }
  return out;
}

function formatStamp(t: number): string {
  if (!t) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(t));
}
