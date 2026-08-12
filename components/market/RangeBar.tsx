"use client";

import { motion } from "motion/react";

import type { Currency } from "@/lib/format";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Where the last print sits inside a low–high band.
 *
 * Used for both the session range and the 52-week range. It answers a question
 * a bare percentage cannot: a stock up 0.4% that is pinned to the top of its
 * day is a different situation from one up 0.4% that has round-tripped, and
 * the marker position shows that instantly.
 */
export function RangeBar({
  low,
  high,
  value,
  currency,
  showLabels = false,
  className,
  height = 3,
}: {
  low: number;
  high: number;
  value: number;
  currency: Currency;
  showLabels?: boolean;
  className?: string;
  height?: number;
}) {
  const span = high - low;
  // A band with no width (pre-open, or a halted name) would divide by zero;
  // centring the marker is the honest reading.
  const position = span > 0 ? Math.max(0, Math.min(1, (value - low) / span)) : 0.5;
  const pct = position * 100;

  return (
    <div className={cn("w-full", className)}>
      {showLabels && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="num-mono text-[10px] text-ivory-40">{formatPrice(low, currency)}</span>
          <span className="num-mono text-[10px] text-ivory-40">{formatPrice(high, currency)}</span>
        </div>
      )}

      <div
        className="relative w-full overflow-visible rounded-full bg-ink-700"
        style={{ height }}
        role="meter"
        aria-valuemin={low}
        aria-valuemax={high}
        aria-valuenow={value}
        aria-label="Position within range"
      >
        {/* Filled portion, tinted by which half of the band we are in. */}
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            position >= 0.5 ? "bg-up/45" : "bg-down/45",
          )}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 180, damping: 26 }}
        />

        <motion.span
          className={cn(
            "absolute top-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink-900",
            position >= 0.5 ? "bg-up" : "bg-down",
          )}
          style={{ height: height + 3, width: height + 3, marginLeft: -(height + 3) / 2 }}
          initial={false}
          animate={{ left: `${pct}%` }}
          transition={{ type: "spring", stiffness: 180, damping: 26 }}
        />
      </div>
    </div>
  );
}
