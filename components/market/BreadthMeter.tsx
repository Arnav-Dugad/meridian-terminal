"use client";

import { motion } from "motion/react";

import type { MarketBreadth } from "@/lib/twelvedata/types";
import { REGION_LABEL } from "@/lib/market/exchanges";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Delta } from "@/components/ui/primitives";

/**
 * Advance–decline breadth.
 *
 * The index number alone is a weighted average, and a weighted average of a
 * hundred names is dominated by six of them. Breadth is the corrective: an
 * index up 0.6% on 40% participation is a narrow, fragile tape, and that is
 * visible here in one glance where the headline figure hides it.
 *
 * The bar is participation; the figures beside it separate the cap-weighted
 * move (what the index did) from the equal-weighted one (what the average
 * stock did). When those two diverge, that gap is the story.
 */
export function BreadthMeter({
  breadth,
  className,
}: {
  breadth: MarketBreadth;
  className?: string;
}) {
  const total = breadth.advancing + breadth.declining + breadth.unchanged || 1;
  const advPct = (breadth.advancing / total) * 100;
  const decPct = (breadth.declining / total) * 100;
  const unchPct = 100 - advPct - decPct;

  const accent = breadth.region === "IN" ? "#f0a63c" : "#7ba7f0";
  const divergence = breadth.weightedChange - breadth.meanChange;

  return (
    <div className={cn("", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: accent }} />
          <span className="label-micro text-ivory-80">{REGION_LABEL[breadth.region]}</span>
        </p>
        <Delta value={breadth.weightedChange} size="sm" />
      </div>

      {/* Participation bar. */}
      <div className="mt-3.5 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-ink-800">
        <motion.span
          className="bg-up"
          initial={{ width: 0 }}
          animate={{ width: `${advPct}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.span
          className="bg-ink-600"
          initial={{ width: 0 }}
          animate={{ width: `${unchPct}%` }}
          transition={{ duration: 0.8, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.span
          className="bg-down"
          initial={{ width: 0 }}
          animate={{ width: `${decPct}%` }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="num-mono text-[11px] text-up">{breadth.advancing} adv</span>
        <span className="num-mono text-[11px] text-ivory-40">
          {(breadth.ratio * 100).toFixed(0)}% participation
        </span>
        <span className="num-mono text-[11px] text-down">{breadth.declining} dec</span>
      </div>

      <dl className="mt-4 space-y-2 border-t border-line pt-3.5">
        <Row label="Cap-weighted" value={formatPercent(breadth.weightedChange)} tone={breadth.weightedChange} />
        <Row label="Equal-weighted" value={formatPercent(breadth.meanChange)} tone={breadth.meanChange} />
        <Row
          label="Divergence"
          value={formatPercent(divergence)}
          tone={0}
          hint={
            Math.abs(divergence) < 0.15
              ? "Index and average agree"
              : divergence > 0
                ? "Large caps carrying the index"
                : "Rally broader than the index"
          }
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: number;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-ivory-40">
        {label}
        {hint && <span className="ml-1.5 text-ivory-25">· {hint}</span>}
      </dt>
      <dd
        className={cn(
          "num-mono shrink-0 text-[11px]",
          tone > 0.001 ? "text-up" : tone < -0.001 ? "text-down" : "text-ivory-80",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
