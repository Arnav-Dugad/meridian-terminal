"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, EmptyState, Panel, PanelHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { IconBriefcase, IconRefresh, IconSearch } from "@/components/ui/icons";
import { Input } from "@/components/ui/primitives";
import { formatCompactMoney, formatDate, formatNumber, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Bulk and block deals.
 *
 * India requires large trades to be disclosed *by name*, which makes this one
 * of the very few places you can watch a specific institution build or exit a
 * specific position. A bulk deal is any trade above 0.5% of a company's
 * shares; a block deal is a negotiated trade above a size threshold, executed
 * in its own window.
 *
 * Sorted by value rather than time, because the question is which deals
 * mattered, not which happened last.
 */

interface Deal {
  kind: "bulk" | "block" | "short";
  symbol: string;
  slug: string | null;
  name: string;
  client: string;
  side: "BUY" | "SELL" | null;
  quantity: number;
  price: number | null;
  value: number | null;
  date: string;
}

interface Payload {
  data: Deal[];
  asOfLabel: string;
  summary: {
    buyValue: number;
    sellValue: number;
    netValue: number;
    bulk: number;
    block: number;
    short: number;
  } | null;
  notice?: string;
}

type Filter = "all" | "bulk" | "block" | "buy" | "sell";

export function DealsView() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/deals", { cache: "no-store" });
      if (res.ok) setPayload((await res.json()) as Payload);
    } catch {
      /* empty state covers it */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const deals = useMemo(() => {
    const rows = (payload?.data ?? []).filter((d) => d.kind !== "short");
    const q = query.trim().toLowerCase();

    return rows.filter((d) => {
      if (filter === "bulk" || filter === "block") {
        if (d.kind !== filter) return false;
      } else if (filter === "buy" || filter === "sell") {
        if (d.side !== filter.toUpperCase()) return false;
      }
      if (!q) return true;
      return (
        d.symbol.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q) ||
        d.client.toLowerCase().includes(q)
      );
    });
  }, [payload?.data, filter, query]);

  /** The institutions that moved the most value in the session. */
  const topBuyers = useMemo(() => aggregateByClient(payload?.data ?? [], "BUY"), [payload?.data]);
  const topSellers = useMemo(() => aggregateByClient(payload?.data ?? [], "SELL"), [payload?.data]);

  const summary = payload?.summary;

  return (
    <>
      <PageHeader
        eyebrow="India · large trades"
        title="Who took a position"
        description="Indian rules require large trades to be disclosed by name. This is where you find out which fund bought into which company yesterday, and how much they paid."
        meta={
          <>
            {payload?.asOfLabel && <Badge tone="india">{payload.asOfLabel}</Badge>}
            {summary && (
              <>
                <Badge tone="neutral">{summary.bulk} bulk</Badge>
                <Badge tone="neutral">{summary.block} block</Badge>
              </>
            )}
          </>
        }
        actions={
          <Button variant="outline" size="md" icon={<IconRefresh />} onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      <PageBody className="space-y-5">
        {loading && !payload ? (
          <Panel flush>
            <div className="space-y-3 p-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </Panel>
        ) : !payload || payload.data.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<IconBriefcase />}
              title="No deals available"
              description={
                payload?.notice ??
                "The exchange publishes these after each session closes. Check back a little later."
              }
              action={
                <Button variant="secondary" size="md" onClick={load}>
                  Try again
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {/* Session summary */}
            {summary && (
              <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
                <Cell label="Disclosed buying" value={formatCompactMoney(summary.buyValue, "INR")} tone={1} />
                <Cell label="Disclosed selling" value={formatCompactMoney(summary.sellValue, "INR")} tone={-1} />
                <Cell
                  label="Net"
                  value={formatCompactMoney(Math.abs(summary.netValue), "INR")}
                  tone={summary.netValue}
                  sub={summary.netValue >= 0 ? "Net accumulation" : "Net distribution"}
                />
              </div>
            )}

            {/* Most active institutions */}
            {(topBuyers.length > 0 || topSellers.length > 0) && (
              <div className="grid gap-5 lg:grid-cols-2">
                <ClientPanel title="Biggest buyers" rows={topBuyers} tone="up" />
                <ClientPanel title="Biggest sellers" rows={topSellers} tone="down" />
              </div>
            )}

            {/* Filters */}
            <Panel>
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  value={filter}
                  onChange={setFilter}
                  layoutIdSuffix="deals-filter"
                  options={[
                    { value: "all", label: "All" },
                    { value: "bulk", label: "Bulk" },
                    { value: "block", label: "Block" },
                    { value: "buy", label: "Buys" },
                    { value: "sell", label: "Sells" },
                  ]}
                />
                <div className="min-w-[200px] flex-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by company or institution…"
                    leading={<IconSearch />}
                  />
                </div>
              </div>
            </Panel>

            <Panel flush>
              <PanelHeader
                title="Deals"
                subtitle="Largest first, by value"
                action={<Badge tone="neutral">{deals.length}</Badge>}
              />

              {deals.length === 0 ? (
                <EmptyState title="Nothing matches" description="Loosen the filter or clear the search." />
              ) : (
                <div className="table-scroll">
                  <table className="w-full min-w-[720px] border-collapse">
                    <thead>
                      <tr className="border-b border-line">
                        {["Company", "Institution", "Side", "Quantity", "Price", "Value"].map((h, i) => (
                          <th
                            key={h}
                            className={cn(
                              "label-micro px-4 py-2.5 font-medium text-ivory-40",
                              i >= 3 ? "text-right" : "text-left",
                            )}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deals.slice(0, 120).map((d, i) => (
                        <motion.tr
                          key={`${d.symbol}-${d.client}-${d.side}-${i}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.25, delay: Math.min(i * 0.01, 0.3) }}
                          className="border-b border-line/60 hover:bg-ink-850"
                        >
                          <td className="px-4 py-2.5">
                            {d.slug ? (
                              <Link href={`/stock/${encodeURIComponent(d.slug)}`} className="group">
                                <span className="num-mono text-[12px] text-ivory group-hover:text-signal">
                                  {d.symbol}
                                </span>
                                <span className="mt-0.5 block max-w-[24ch] truncate text-[10px] text-ivory-40">
                                  {d.name}
                                </span>
                              </Link>
                            ) : (
                              <>
                                <span className="num-mono text-[12px] text-ivory-80">{d.symbol}</span>
                                <span className="mt-0.5 block max-w-[24ch] truncate text-[10px] text-ivory-40">
                                  {d.name}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block max-w-[34ch] truncate text-[11px] text-ivory-60">
                              {titleCase(d.client)}
                            </span>
                            <Badge tone={d.kind === "block" ? "signal" : "neutral"} className="mt-1">
                              {d.kind}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            {d.side && (
                              <span
                                className={cn(
                                  "label-micro-tight rounded-[3px] px-1.5 py-1",
                                  d.side === "BUY" ? "bg-up/12 text-up" : "bg-down/12 text-down",
                                )}
                              >
                                {d.side}
                              </span>
                            )}
                          </td>
                          <td className="num-mono px-4 py-2.5 text-right text-[11px] text-ivory-60">
                            {formatNumber(d.quantity, "INR")}
                          </td>
                          <td className="num-mono px-4 py-2.5 text-right text-[11px] text-ivory-60">
                            {d.price != null ? formatPrice(d.price, "INR") : "—"}
                          </td>
                          <td
                            className={cn(
                              "num-mono px-4 py-2.5 text-right text-[12px]",
                              d.side === "BUY" ? "text-up" : d.side === "SELL" ? "text-down" : "text-ivory",
                            )}
                          >
                            {d.value != null ? formatCompactMoney(d.value, "INR") : "—"}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
              A bulk deal is any trade exceeding 0.5% of a company's equity; a block deal is
              a negotiated trade above a size threshold, executed in a separate window. Both
              are disclosed by name the same evening. A single fund appearing on both sides
              across days is usually rebalancing, not conviction.
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function aggregateByClient(deals: Deal[], side: "BUY" | "SELL") {
  const map = new Map<string, { client: string; value: number; count: number }>();

  for (const d of deals) {
    if (d.side !== side || d.kind === "short" || d.value == null) continue;
    const key = d.client.toUpperCase();
    const row = map.get(key);
    if (row) {
      row.value += d.value;
      row.count += 1;
    } else {
      map.set(key, { client: d.client, value: d.value, count: 1 });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function ClientPanel({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { client: string; value: number; count: number }[];
  tone: "up" | "down";
}) {
  if (rows.length === 0) return null;
  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <Panel flush>
      <PanelHeader title={title} subtitle="By disclosed value in the session" />
      <ul className="divide-y divide-line/60">
        {rows.map((r, i) => (
          <li key={r.client} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ivory-80">
                {titleCase(r.client)}
              </span>
              <span className={cn("num-mono shrink-0 text-[12px]", tone === "up" ? "text-up" : "text-down")}>
                {formatCompactMoney(r.value, "INR")}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-800">
                <motion.div
                  className={cn("h-full rounded-full", tone === "up" ? "bg-up/70" : "bg-down/70")}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.value / peak) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="num-mono shrink-0 text-[10px] text-ivory-40">
                {r.count} deal{r.count === 1 ? "" : "s"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: number;
}) {
  return (
    <div className="bg-ink-900 p-5">
      <p className="label-micro text-ivory-40">{label}</p>
      <p
        className={cn(
          "num-mono mt-3 text-[24px] leading-none tracking-tight",
          tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-2.5 text-[11px] text-ivory-40">{sub}</p>}
    </div>
  );
}

/** Exchange filings arrive in shouting caps; this makes them readable. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Llp|Ltd|Plc|Inc|Pvt)\b/g, (m) => m.toUpperCase());
}
