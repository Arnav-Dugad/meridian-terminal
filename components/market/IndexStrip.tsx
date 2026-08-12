"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { useQuotes } from "@/lib/hooks/market-data";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Sparkline } from "@/components/chart/Sparkline";
import { Delta, StatusDot } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/format";
import { sessionState } from "@/lib/market/exchanges";
import { findBySlug } from "@/lib/market/universe";
import type { Quote } from "@/lib/twelvedata/types";
import { cn } from "@/lib/utils";

export interface IndexSeed {
  slug: string;
  quote: Quote;
  /** Closing prices for the sparkline, oldest first. */
  spark: number[];
}

/**
 * The index rail.
 *
 * Server-rendered from a seed so the first paint carries real numbers — an
 * empty row of skeletons above the fold is the fastest way to look unfinished
 * — then handed to the live store, which takes over updating in place.
 */
export function IndexStrip({
  seeds,
  className,
  columns = 4,
}: {
  seeds: IndexSeed[];
  className?: string;
  columns?: number;
}) {
  const slugs = seeds.map((s) => s.slug);
  const { quotes } = useQuotes(slugs);

  return (
    <div
      className={cn("grid gap-px overflow-hidden rounded-md border border-line bg-line", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {seeds.map((seed, i) => (
        <IndexCard key={seed.slug} seed={seed} live={quotes[i]} index={i} />
      ))}
    </div>
  );
}

function IndexCard({ seed, live, index }: { seed: IndexSeed; live: Quote | undefined; index: number }) {
  const quote = live ?? seed.quote;
  const instrument = findBySlug(seed.slug);
  const session = instrument ? sessionState(instrument.exchange) : null;
  const region = instrument?.region ?? "US";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
      className="group relative bg-ink-900 transition-colors duration-200 hover:bg-ink-850"
    >
      <Link href={`/stock/${encodeURIComponent(seed.slug)}`} className="block p-3.5">
        {/* Region tint on the leading edge — amber for India, blue for the US. */}
        <span
          className="absolute inset-y-0 left-0 w-px opacity-60"
          style={{ backgroundColor: region === "IN" ? "#f0a63c" : "#7ba7f0" }}
        />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="label-micro truncate text-ivory-60">{quote.name}</p>
            <p className="label-micro-tight mt-1 text-ivory-40">{instrument?.exchange}</p>
          </div>
          {session?.isLive && <StatusDot tone="up" live className="mt-0.5" />}
        </div>

        <p className="num-mono mt-3 text-[19px] leading-none tracking-tight text-ivory">
          <AnimatedNumber
            value={quote.price}
            format={(v) => formatNumber(v, quote.currency, 2)}
            flash
          />
        </p>

        <div className="mt-2.5 flex items-end justify-between gap-2">
          <Delta value={quote.changePercent} size="xs" />
          <Sparkline
            values={seed.spark}
            width={64}
            height={22}
            filled={false}
            strokeWidth={1.2}
            className="opacity-70 transition-opacity duration-200 group-hover:opacity-100"
          />
        </div>
      </Link>
    </motion.div>
  );
}
