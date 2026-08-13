"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, EmptyState, Panel, PanelHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { IconChart, IconRefresh, IconStar } from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { formatCompactMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The earnings calendar.
 *
 * Grouped by day rather than listed flat, because the question people bring to
 * a calendar is "what happens this week", not "what is the 40th row". Names on
 * the watchlist are pulled to the top of their day and marked, since those are
 * the only ones most readers will act on.
 */

interface CalendarEntry {
  symbol: string;
  slug: string | null;
  name: string | null;
  date: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
  region: "IN" | "US";
  hour: string | null;
}

type Filter = "all" | "watchlist" | "IN" | "US";

export function EarningsView() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(21);
  const [filter, setFilter] = useState<Filter>("all");
  const { watchlist } = usePersonal();

  const load = async (window: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/earnings-calendar?days=${window}`);
      if (res.ok) {
        const body = (await res.json()) as { data: CalendarEntry[] };
        setEntries(body.data);
      }
    } catch {
      /* empty state handles it */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(days);
  }, [days]);

  const watched = useMemo(() => new Set(watchlist), [watchlist]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter === "watchlist") return e.slug != null && watched.has(e.slug);
      if (filter === "IN" || filter === "US") return e.region === filter;
      return true;
    });
  }, [entries, filter, watched]);

  /** Grouped by date, with watched names first inside each day. */
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of filtered) {
      const list = map.get(e.date);
      if (list) list.push(e);
      else map.set(e.date, [e]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aw = a.slug != null && watched.has(a.slug);
        const bw = b.slug != null && watched.has(b.slug);
        if (aw !== bw) return aw ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, watched]);

  const watchedCount = entries.filter((e) => e.slug != null && watched.has(e.slug)).length;

  return (
    <>
      <PageHeader
        eyebrow="Earnings"
        title="What reports, and when"
        description="Upcoming results across both markets. Open any instrument you track to see how it has actually behaved around past reports."
        meta={
          <>
            <Badge tone="neutral">{filtered.length} reports</Badge>
            {watchedCount > 0 && <Badge tone="signal">{watchedCount} on your watchlist</Badge>}
          </>
        }
        actions={
          <>
            <Segmented
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              layoutIdSuffix="earn-window"
              options={[
                { value: "7", label: "1w" },
                { value: "21", label: "3w" },
                { value: "45", label: "6w" },
              ]}
            />
            <Button
              variant="outline"
              size="md"
              icon={<IconRefresh />}
              onClick={() => load(days)}
              loading={loading}
            >
              Refresh
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        <Panel>
          <Segmented
            value={filter}
            onChange={setFilter}
            layoutIdSuffix="earn-filter"
            options={[
              { value: "all", label: "Everything" },
              { value: "watchlist", label: "My watchlist" },
              { value: "IN", label: "India" },
              { value: "US", label: "United States" },
            ]}
          />
        </Panel>

        {loading && entries.length === 0 ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Panel key={i} flush>
                <div className="border-b border-line px-4 py-3">
                  <Skeleton className="h-3 w-32" />
                </div>
                <div className="space-y-3 p-4">
                  {[0, 1, 2].map((j) => (
                    <Skeleton key={j} className="h-8 w-full" />
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<IconChart />}
              title="Nothing scheduled"
              description={
                filter === "watchlist"
                  ? "None of the instruments you track report in this window. Widen the range or clear the filter."
                  : "No results are scheduled in this window."
              }
            />
          </Panel>
        ) : (
          grouped.map(([date, rows], groupIndex) => (
            <motion.div
              key={date}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(groupIndex * 0.04, 0.3) }}
            >
              <Panel flush>
                <PanelHeader
                  title={formatDate(date)}
                  subtitle={relativeDay(date)}
                  action={<Badge tone="neutral">{rows.length}</Badge>}
                />
                <ul className="divide-y divide-line/60">
                  {rows.map((entry) => (
                    <EarningsRow
                      key={`${entry.symbol}-${entry.date}`}
                      entry={entry}
                      watched={entry.slug != null && watched.has(entry.slug)}
                    />
                  ))}
                </ul>
              </Panel>
            </motion.div>
          ))
        )}

        <IpoPanel />

        <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
          Dates are as published and do move. Indian coverage spans the largest listed
          names; US coverage is the full exchange calendar.
        </p>
      </PageBody>
    </>
  );
}

function EarningsRow({ entry, watched }: { entry: CalendarEntry; watched: boolean }) {
  const timing =
    entry.hour === "bmo"
      ? "Before the open"
      : entry.hour === "amc"
        ? "After the close"
        : entry.hour === "dmh"
          ? "During the session"
          : null;

  const body = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="h-6 w-[2px] shrink-0 rounded-full opacity-70"
          style={{ backgroundColor: entry.region === "IN" ? "#f0a63c" : "#7ba7f0" }}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="num-mono text-[12px] font-medium text-ivory">{entry.symbol}</span>
            {watched && <IconStar className="h-3 w-3 shrink-0 text-signal" />}
            {entry.quarter && entry.year && (
              <Badge tone="neutral">
                Q{entry.quarter} {entry.year}
              </Badge>
            )}
          </span>
          {entry.name && (
            <span className="mt-0.5 block max-w-[36ch] truncate text-[11px] text-ivory-40">
              {entry.name}
            </span>
          )}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-5">
        {entry.epsEstimate != null && (
          <span className="text-right">
            <span className="label-micro block text-ivory-40">EPS est.</span>
            <span className="num-mono mt-0.5 block text-[12px] text-ivory">
              {entry.epsEstimate.toFixed(2)}
            </span>
          </span>
        )}
        {entry.revenueEstimate != null && (
          <span className="hidden text-right sm:block">
            <span className="label-micro block text-ivory-40">Revenue est.</span>
            <span className="num-mono mt-0.5 block text-[12px] text-ivory-60">
              {formatCompactMoney(entry.revenueEstimate, entry.region === "IN" ? "INR" : "USD")}
            </span>
          </span>
        )}
        {timing && <span className="label-micro-tight hidden text-ivory-40 md:block">{timing}</span>}
      </div>
    </div>
  );

  // Only names in the universe can be opened; the rest still get listed.
  return (
    <li className={cn("transition-colors", entry.slug && "hover:bg-ink-850")}>
      {entry.slug ? (
        <Link href={`/stock/${encodeURIComponent(entry.slug)}`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/* ── New listings ─────────────────────────────────────────────────────────── */

interface IpoEntry {
  symbol: string | null;
  name: string;
  exchange: string | null;
  date: string;
  status: string | null;
  shares: number | null;
  priceRange: string | null;
  totalValue: number | null;
}

/**
 * The IPO calendar.
 *
 * Companies about to start trading are the one part of the market with no
 * price history to look at, which is exactly where a calendar earns its place.
 */
function IpoPanel() {
  const [entries, setEntries] = useState<IpoEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/insiders", { signal: controller.signal });
        const body = (await res.json()) as { data: IpoEntry[]; notice?: string };
        if (cancelled) return;
        setEntries(body.data);
        setNotice(body.notice ?? null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setNotice("The listings calendar could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const upcoming = entries.filter((e) => e.status !== "withdrawn").slice(0, 12);

  return (
    <Panel flush>
      <PanelHeader
        title="New listings"
        subtitle="Companies about to start trading"
        action={upcoming.length > 0 ? <Badge tone="neutral">{upcoming.length}</Badge> : undefined}
      />

      {loading ? (
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyState
          title="No listings scheduled"
          description={notice ?? "Nothing is scheduled to list in the coming weeks."}
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {upcoming.map((e, i) => (
            <motion.li
              key={`${e.name}-${e.date}-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.28, delay: Math.min(i * 0.03, 0.25) }}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-ink-850"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  {e.symbol && (
                    <span className="num-mono text-[12px] text-ivory">{e.symbol}</span>
                  )}
                  <span className="max-w-[34ch] truncate text-[12px] text-ivory-80">{e.name}</span>
                  {e.status && (
                    <Badge tone={e.status === "priced" ? "up" : "neutral"}>{e.status}</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[10px] text-ivory-40">
                  {e.exchange ?? "—"} · {formatDate(e.date)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-5 text-right">
                {e.priceRange && (
                  <span>
                    <span className="label-micro block text-ivory-40">Price</span>
                    <span className="num-mono mt-0.5 block text-[11px] text-ivory">
                      {e.priceRange}
                    </span>
                  </span>
                )}
                {e.totalValue != null && e.totalValue > 0 && (
                  <span className="hidden sm:block">
                    <span className="label-micro block text-ivory-40">Raising</span>
                    <span className="num-mono mt-0.5 block text-[11px] text-ivory-60">
                      {formatCompactMoney(e.totalValue, "USD")}
                    </span>
                  </span>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function relativeDay(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  if (diff < 7) return `In ${diff} days`;
  return `In ${Math.round(diff / 7)} week${diff >= 14 ? "s" : ""}`;
}
