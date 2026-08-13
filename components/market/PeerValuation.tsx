"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import type { Fundamentals } from "@/lib/providers/types";
import { Badge, EmptyState, Panel, PanelHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { IconScale } from "@/components/ui/icons";
import { findBySymbol, type Instrument } from "@/lib/market/universe";
import { formatCompactMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Peer valuation.
 *
 * Eight comparable companies in one grid of multiples and margins — the table
 * a sell-side analyst builds by hand and almost no consumer product ships.
 *
 * The design decision that makes it useful is the shading: each column is
 * scaled against its own peer group, so a cell's colour says "cheap relative
 * to these specific companies" rather than against some absolute notion of
 * cheap. A P/E of 30 is expensive for a bank and unremarkable for software,
 * and only the peer set knows which.
 */

interface PeerRow {
  symbol: string;
  instrument: Instrument | undefined;
  fundamentals: Fundamentals | null;
  isSubject: boolean;
}

interface Column {
  key: keyof Fundamentals;
  label: string;
  hint: string;
  format: "ratio" | "percent" | "money";
  /** 1 = higher is better, -1 = lower is better, 0 = no ordering. */
  polarity: 1 | -1 | 0;
}

const COLUMNS: Column[] = [
  { key: "marketCap", label: "Size", hint: "Market capitalisation.", format: "money", polarity: 0 },
  { key: "peRatio", label: "P/E", hint: "Price over trailing earnings. Shaded against this peer group, not an absolute scale.", format: "ratio", polarity: -1 },
  { key: "priceToBook", label: "P/B", hint: "Price over book value. The primary multiple for banks and asset-heavy businesses.", format: "ratio", polarity: -1 },
  { key: "netMargin", label: "Net margin", hint: "Profit as a share of revenue.", format: "percent", polarity: 1 },
  { key: "roe", label: "ROE", hint: "Return on equity. Flattered by leverage, so read it beside debt.", format: "percent", polarity: 1 },
  { key: "revenueGrowth", label: "Growth", hint: "Year-on-year revenue growth.", format: "percent", polarity: 1 },
  { key: "debtToEquity", label: "D/E", hint: "Debt relative to equity. Higher means more leverage.", format: "ratio", polarity: -1 },
];

export function PeerValuation({
  slug,
  symbol,
  peers,
  subject,
  loading,
  className,
}: {
  slug: string;
  symbol: string;
  peers: string[];
  subject: Fundamentals | null;
  loading: boolean;
  className?: string;
}) {
  const [rows, setRows] = useState<PeerRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Only peers the terminal can actually resolve are worth fetching.
  const resolvable = useMemo(
    () =>
      peers
        .map((s) => ({ symbol: s, instrument: findBySymbol(s) }))
        .filter((p): p is { symbol: string; instrument: Instrument } => Boolean(p.instrument))
        .slice(0, 7),
    [peers],
  );

  useEffect(() => {
    if (resolvable.length === 0) {
      setRows([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setFetching(true);
    setNotice(null);

    (async () => {
      const results = await Promise.all(
        resolvable.map(async (p): Promise<PeerRow | null> => {
          try {
            const res = await fetch(
              `/api/fundamentals?symbol=${encodeURIComponent(p.instrument.slug)}`,
              { signal: controller.signal },
            );
            if (!res.ok) return null;
            const body = (await res.json()) as { data: { fundamentals: Fundamentals | null } };
            return {
              symbol: p.symbol,
              instrument: p.instrument,
              fundamentals: body.data.fundamentals,
              isSubject: false,
            };
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      const usable = results.filter((r): r is PeerRow => r !== null && r.fundamentals !== null);
      setRows(usable);
      if (usable.length === 0) {
        setNotice("Comparable data could not be retrieved for any peer just now.");
      }
      setFetching(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resolvable]);

  const subjectRow: PeerRow = {
    symbol,
    instrument: findBySymbol(symbol),
    fundamentals: subject,
    isSubject: true,
  };

  const allRows = useMemo(() => [subjectRow, ...rows], [subjectRow, rows]);

  // Per-column min and max across the group, which is what the shading uses.
  const extents = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    for (const col of COLUMNS) {
      const values = allRows
        .map((r) => r.fundamentals?.[col.key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (values.length >= 2) {
        map.set(String(col.key), { min: Math.min(...values), max: Math.max(...values) });
      }
    }
    return map;
  }, [allRows]);

  if (loading || fetching) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Peer comparison" subtitle="Valuation against comparable companies" />
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Peer comparison" subtitle="Valuation against comparable companies" />
        <EmptyState
          icon={<IconScale />}
          title="No comparable set available"
          description={
            notice ??
            "No peer list is published for this company by the sources in use, so there is nothing to compare it against."
          }
        />
      </Panel>
    );
  }

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Peer comparison"
        subtitle="Shaded within this group — green is better relative to these companies, not in absolute terms"
        action={<Badge tone="neutral">{rows.length} peers</Badge>}
      />

      <div className="table-scroll">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="label-micro sticky left-0 bg-ink-900 px-4 py-2.5 text-left font-medium text-ivory-40">
                Company
              </th>
              {COLUMNS.map((col) => (
                <th key={String(col.key)} className="label-micro px-3 py-2.5 text-right font-medium text-ivory-40">
                  <Tooltip content={col.hint} side="bottom">
                    <span className="cursor-help border-b border-dotted border-line-strong">
                      {col.label}
                    </span>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {allRows.map((row, i) => (
              <motion.tr
                key={row.symbol}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className={cn(
                  "border-b border-line/60",
                  row.isSubject ? "bg-signal/[0.06]" : "hover:bg-ink-850",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 px-4 py-2.5",
                    row.isSubject ? "bg-[color-mix(in_srgb,var(--color-signal)_6%,var(--color-ink-900))]" : "bg-ink-900",
                  )}
                >
                  {row.instrument ? (
                    <Link
                      href={`/stock/${encodeURIComponent(row.instrument.slug)}`}
                      className="group flex items-center gap-2"
                    >
                      <span
                        className={cn(
                          "num-mono text-[12px]",
                          row.isSubject ? "text-signal" : "text-ivory group-hover:text-signal",
                        )}
                      >
                        {row.symbol}
                      </span>
                      {row.isSubject && <Badge tone="signal">this</Badge>}
                    </Link>
                  ) : (
                    <span className="num-mono text-[12px] text-ivory-60">{row.symbol}</span>
                  )}
                  <span className="mt-0.5 block max-w-[22ch] truncate text-[10px] text-ivory-40">
                    {row.instrument?.name ?? ""}
                  </span>
                </td>

                {COLUMNS.map((col) => {
                  const value = row.fundamentals?.[col.key];
                  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
                  const extent = extents.get(String(col.key));

                  return (
                    <td key={String(col.key)} className="px-3 py-2.5 text-right">
                      <span
                        className="num-mono inline-block min-w-[52px] rounded-[3px] px-1.5 py-1 text-[11px]"
                        style={
                          numeric != null && extent && col.polarity !== 0
                            ? { backgroundColor: shade(numeric, extent, col.polarity) }
                            : undefined
                        }
                      >
                        <span className={numeric == null ? "text-ivory-40" : "text-ivory"}>
                          {formatCell(numeric, col, row.instrument)}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Peers are the comparable set published for this company. Shading is relative to this
        group only — a P/E of 30 is expensive for a bank and unremarkable for software, and
        only the peer set knows which. Blank cells mean the figure was not published, not
        that it is zero.
      </p>
    </Panel>
  );
}

function formatCell(value: number | null, col: Column, inst: Instrument | undefined): string {
  if (value == null) return "—";
  if (col.format === "money") return formatCompactMoney(value, inst?.currency ?? "USD");
  if (col.format === "percent") return `${value.toFixed(1)}%`;
  return value.toFixed(1);
}

/**
 * Position within the peer range, tinted by whether higher or lower is better.
 * Alpha is floored so a mid-range cell is still visibly part of the scale.
 */
function shade(value: number, extent: { min: number; max: number }, polarity: 1 | -1): string {
  const span = extent.max - extent.min;
  if (span <= 0) return "transparent";

  const position = (value - extent.min) / span;
  const goodness = polarity === 1 ? position : 1 - position;
  // Only tint the ends; the middle of a peer group is not a signal.
  const strength = Math.abs(goodness - 0.5) * 2;
  const colour = goodness >= 0.5 ? "63, 191, 127" : "240, 86, 63";
  return `rgba(${colour}, ${strength * 0.26})`;
}
