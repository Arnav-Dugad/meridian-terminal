"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useQuotes } from "@/lib/hooks/market-data";
import { formatPrice, formatPercent, directionOf, type Currency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { findBySlug } from "@/lib/market/universe";

/**
 * The tape.
 *
 * A continuous marquee of live prices. Two details make it feel like a real
 * ticker rather than a CSS demo: the track is duplicated and translated by
 * exactly half its width, so the loop is seamless with no visible reset, and
 * it pauses under the pointer — a scrolling list you cannot click is hostile,
 * and the pause is what turns it from decoration into navigation.
 *
 * Duration scales with symbol count so the reading speed stays constant
 * whether the tape holds eight names or thirty.
 */
export function Tape({
  symbols,
  className,
  speed = 1,
  showExchange = false,
}: {
  symbols: string[];
  className?: string;
  /** Multiplier on the scroll duration. Lower is faster. */
  speed?: number;
  showExchange?: boolean;
}) {
  const { quotes } = useQuotes(symbols);
  const [paused, setPaused] = useState(false);

  const items = useMemo(
    () =>
      symbols.map((slug, i) => ({
        slug,
        instrument: findBySlug(slug),
        quote: quotes[i],
      })),
    [symbols, quotes],
  );

  // ~4.4s of travel per item keeps the tape readable at any length.
  const duration = Math.max(28, items.length * 4.4 * speed);

  return (
    <div
      className={cn("group relative overflow-hidden", className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="mask-fade-x flex w-max">
        <div
          className="marquee-track flex shrink-0"
          style={{
            animationDuration: `${duration}s`,
            animationPlayState: paused ? "paused" : "running",
          }}
        >
          {/* Rendered twice; the keyframe translates exactly -50%. */}
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
              {items.map(({ slug, instrument, quote }) => (
                <TapeItem
                  key={`${copy}-${slug}`}
                  slug={slug}
                  name={instrument?.symbol ?? slug}
                  exchange={showExchange ? instrument?.exchange : undefined}
                  price={quote?.price}
                  changePercent={quote?.changePercent}
                  currency={instrument?.currency ?? "USD"}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TapeItem({
  slug,
  name,
  exchange,
  price,
  changePercent,
  currency,
}: {
  slug: string;
  name: string;
  exchange?: string;
  price: number | undefined;
  changePercent: number | undefined;
  currency: Currency;
}) {
  const dir = directionOf(changePercent);

  return (
    <Link
      href={`/stock/${encodeURIComponent(slug)}`}
      className="flex shrink-0 items-baseline gap-2.5 border-r border-line px-5 py-2.5 transition-colors duration-150 hover:bg-ink-850"
    >
      <span className="num-mono text-[11px] font-medium tracking-tight text-ivory-80">{name}</span>
      {exchange && <span className="label-micro-tight text-ivory-40">{exchange}</span>}
      <span className="num-mono text-[11px] text-ivory">
        {price != null ? formatPrice(price, currency) : "—"}
      </span>
      <span
        className={cn(
          "num-mono text-[11px]",
          dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ivory-40",
        )}
      >
        {changePercent != null ? formatPercent(changePercent) : "—"}
      </span>
    </Link>
  );
}
