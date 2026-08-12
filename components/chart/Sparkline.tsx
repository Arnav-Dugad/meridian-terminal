"use client";

import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  /** Overrides the automatic up/down colouring. */
  color?: string;
  width?: number;
  height?: number;
  /** Gradient fill beneath the line. */
  filled?: boolean;
  /** Dashed rule at the first value, so the reader sees the break-even line. */
  showBaseline?: boolean;
  strokeWidth?: number;
  className?: string;
  animate?: boolean;
}

/**
 * Table-row sparkline.
 *
 * SVG rather than canvas here, deliberately: a watchlist can hold forty of
 * these, and forty canvases means forty contexts, forty resize observers and
 * forty raster surfaces. Forty short paths cost the compositor nothing, and
 * the stroke-dash draw-on gets to run on the GPU for free.
 */
export function Sparkline({
  values,
  color,
  width = 120,
  height = 32,
  filled = true,
  showBaseline = false,
  strokeWidth = 1.4,
  className,
  animate = true,
}: SparklineProps) {
  const gradientId = useId();
  const shouldReduceMotion = useReducedMotion();

  const geometry = useMemo(() => {
    if (values.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // A perfectly flat series would divide by zero; give it a hairline band.
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const pad = strokeWidth;
    const usableH = height - pad * 2;
    const x = (i: number) => (i / (values.length - 1)) * width;
    const y = (v: number) => pad + (1 - (v - min) / (max - min)) * usableH;

    let path = `M ${x(0).toFixed(2)} ${y(values[0]!).toFixed(2)}`;
    for (let i = 1; i < values.length; i++) {
      path += ` L ${x(i).toFixed(2)} ${y(values[i]!).toFixed(2)}`;
    }

    const area = `${path} L ${width} ${height} L 0 ${height} Z`;
    const first = values[0]!;
    const last = values[values.length - 1]!;

    return { path, area, baselineY: y(first), rising: last >= first };
  }, [values, width, height, strokeWidth]);

  if (!geometry) {
    return (
      <div
        className={cn("flex items-center", className)}
        style={{ width, height }}
        aria-hidden
      >
        <div className="h-px w-full bg-line" />
      </div>
    );
  }

  const stroke = color ?? (geometry.rising ? "#3fbf7f" : "#f0563f");
  const shouldAnimate = animate && !shouldReduceMotion;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Trend ${geometry.rising ? "up" : "down"}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>

      {showBaseline && (
        <line
          x1={0}
          x2={width}
          y1={geometry.baselineY}
          y2={geometry.baselineY}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      )}

      {filled && (
        <motion.path
          d={geometry.area}
          fill={`url(#${gradientId})`}
          initial={shouldAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.16 }}
        />
      )}

      <motion.path
        d={geometry.path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={shouldAnimate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}
