"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";

import { useQuotes } from "@/lib/hooks/market-data";
import { usePersonal } from "@/lib/store/personal";
import { findBySlug } from "@/lib/market/universe";
import type { Quote } from "@/lib/twelvedata/types";
import { formatCompact, formatCompactMoney, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Badge, Delta, EmptyState, Skeleton } from "@/components/ui/primitives";
import { IconStar, IconStarFilled } from "@/components/ui/icons";
import { RangeBar } from "@/components/market/RangeBar";

/**
 * The workhorse quote table.
 *
 * Used by the dashboard, watchlist and screener, which is why sorting,
 * subscription and formatting all live here rather than being reimplemented
 * three times with three subtly different definitions of "volume".
 *
 * Column choices are opinionated. There is no sparkline: a sparkline per row
 * needs a history request per row, and forty of those would drain a day's
 * credits to draw forty thumbnails. The day-range bar carries comparable
 * information — where the last print sits between the session's high and low —
 * for free, out of data the quote already contains.
 */

export type SortKey = "symbol" | "price" | "change" | "volume" | "turnover" | "range";
export type SortDirection = "asc" | "desc";

interface Column {
  key: SortKey | null;
  label: string;
  align: "left" | "right" | "center";
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "symbol", label: "Instrument", align: "left" },
  { key: "price", label: "Last", align: "right" },
  { key: "change", label: "Change", align: "right" },
  { key: "range", label: "Day range", align: "left", className: "hidden lg:table-cell w-[136px]" },
  { key: "volume", label: "Volume", align: "right", className: "hidden md:table-cell" },
  { key: "turnover", label: "Mkt cap", align: "right", className: "hidden xl:table-cell" },
  { key: null, label: "", align: "center", className: "w-9" },
];

export function QuoteTable({
  symbols,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  defaultSort = "change",
  defaultDirection = "desc",
  maxRows,
  compact = false,
  className,
}: {
  symbols: string[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  defaultSort?: SortKey;
  defaultDirection?: SortDirection;
  maxRows?: number;
  compact?: boolean;
  className?: string;
}) {
  const { quotes } = useQuotes(symbols);
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const [direction, setDirection] = useState<SortDirection>(defaultDirection);

  const rows = useMemo(() => {
    const resolved = symbols
      .map((slug, i) => ({ slug, quote: quotes[i] }))
      .filter((r) => Boolean(findBySlug(r.slug)));

    // Rows without a quote yet sort to the bottom rather than to zero, which
    // would make them leapfrog real losers during the first paint.
    const sorted = resolved.slice().sort((a, b) => {
      if (!a.quote && !b.quote) return 0;
      if (!a.quote) return 1;
      if (!b.quote) return -1;
      const v = compare(a.quote, b.quote, sortKey);
      return direction === "asc" ? v : -v;
    });

    return maxRows ? sorted.slice(0, maxRows) : sorted;
  }, [symbols, quotes, sortKey, direction, maxRows]);

  const onSort = (key: SortKey | null) => {
    if (!key) return;
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(key === "symbol" ? "asc" : "desc");
    }
  };

  if (symbols.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    // `min-w-0` on the wrapper is what keeps the scroll *inside* the table
    // instead of the table widening its grid or flex parent.
    <div className={cn("table-scroll w-full min-w-0", className)}>
      <table className="w-full min-w-[500px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((col) => (
              <th
                key={col.label || "actions"}
                scope="col"
                className={cn(
                  "label-micro select-none px-3 py-2.5 font-medium text-ivory-40",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.align === "left" && "text-left",
                  col.key && "cursor-pointer transition-colors hover:text-ivory-80",
                  col.className,
                )}
                onClick={() => onSort(col.key)}
                aria-sort={
                  col.key === sortKey ? (direction === "asc" ? "ascending" : "descending") : undefined
                }
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.key === sortKey && (
                    <span className="text-signal">{direction === "asc" ? "▲" : "▼"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map(({ slug, quote }, i) => (
            <QuoteRow key={slug} slug={slug} quote={quote} index={i} compact={compact} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function compare(a: Quote, b: Quote, key: SortKey): number {
  switch (key) {
    case "symbol":
      return a.symbol.localeCompare(b.symbol);
    case "price":
      return a.price - b.price;
    case "change":
      return a.changePercent - b.changePercent;
    case "volume":
      return a.volume - b.volume;
    case "turnover":
      return (a.marketCap ?? 0) - (b.marketCap ?? 0);
    case "range": {
      const pos = (q: Quote) =>
        q.dayHigh > q.dayLow ? (q.price - q.dayLow) / (q.dayHigh - q.dayLow) : 0.5;
      return pos(a) - pos(b);
    }
    default:
      return 0;
  }
}

function QuoteRow({
  slug,
  quote,
  index,
  compact,
}: {
  slug: string;
  quote: Quote | undefined;
  index: number;
  compact: boolean;
}) {
  const instrument = findBySlug(slug);
  const { isWatched, toggleWatch } = usePersonal();
  const watched = isWatched(slug);

  if (!instrument) return null;

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.015, 0.2) }}
      className="group border-b border-line/60 transition-colors duration-150 hover:bg-ink-850"
    >
      {/* Instrument */}
      <td className={cn("px-3", compact ? "py-1.5" : "py-2.5")}>
        <Link href={`/stock/${encodeURIComponent(slug)}`} className="flex items-center gap-2.5">
          <span
            className="h-6 w-[2px] shrink-0 rounded-full opacity-70"
            style={{ backgroundColor: instrument.region === "IN" ? "#f0a63c" : "#7ba7f0" }}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="num-mono text-[12px] font-medium text-ivory">
                {instrument.symbol}
              </span>
              {!compact && (
                <Badge tone="neutral" className="hidden sm:inline-flex">
                  {instrument.exchange}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block max-w-[26ch] truncate text-[11px] text-ivory-40 sm:max-w-[34ch]">
              {instrument.name}
            </span>
          </span>
        </Link>
      </td>

      {/* Last */}
      <td className="px-3 py-2.5 text-right">
        {quote ? (
          <span className="num-mono text-[12px] text-ivory">
            <AnimatedNumber
              value={quote.price}
              format={(v) => formatPrice(v, instrument.currency)}
              flash
            />
          </span>
        ) : (
          <Skeleton className="ml-auto h-3.5 w-16" />
        )}
      </td>

      {/* Change */}
      <td className="px-3 py-2.5 text-right">
        {quote ? (
          <Delta value={quote.changePercent} size="sm" />
        ) : (
          <Skeleton className="ml-auto h-4 w-14" />
        )}
      </td>

      {/* Day range */}
      <td className="hidden px-3 py-2.5 lg:table-cell">
        {quote ? (
          <RangeBar
            low={quote.dayLow}
            high={quote.dayHigh}
            value={quote.price}
            currency={instrument.currency}
          />
        ) : (
          <Skeleton className="h-3 w-full" />
        )}
      </td>

      {/* Volume */}
      <td className="hidden px-3 py-2.5 text-right md:table-cell">
        {quote ? (
          <span className="num-mono text-[11px] text-ivory-60">
            {quote.volume > 0 ? formatCompact(quote.volume, instrument.currency) : "—"}
          </span>
        ) : (
          <Skeleton className="ml-auto h-3 w-12" />
        )}
      </td>

      {/* Market cap */}
      <td className="hidden px-3 py-2.5 text-right xl:table-cell">
        {quote ? (
          <span className="num-mono text-[11px] text-ivory-60">
            {formatCompactMoney(quote.marketCap, instrument.currency)}
          </span>
        ) : (
          <Skeleton className="ml-auto h-3 w-14" />
        )}
      </td>

      {/* Watch */}
      <td className="px-2 py-2.5 text-center">
        <button
          onClick={() => toggleWatch(slug)}
          aria-label={watched ? `Remove ${instrument.symbol} from watchlist` : `Add ${instrument.symbol} to watchlist`}
          aria-pressed={watched}
          className={cn(
            "rounded-sm p-1.5 transition-all duration-150",
            watched
              ? "text-signal"
              : "text-ivory-25 opacity-0 hover:text-ivory-80 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          {watched ? <IconStarFilled className="h-3.5 w-3.5" /> : <IconStar className="h-3.5 w-3.5" />}
        </button>
      </td>
    </motion.tr>
  );
}
