"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { QuoteTable } from "@/components/market/QuoteTable";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { Badge, Button, EmptyState, Input, Panel, Segmented } from "@/components/ui/primitives";
import { IconPlus, IconSearch, IconStar, IconTrash } from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { useCommandPalette } from "@/components/shell/CommandPalette";
import { DEFAULT_WATCHLIST, findBySlug, searchUniverse } from "@/lib/market/universe";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Region } from "@/lib/market/exchanges";

type Filter = "all" | Region;

export function WatchlistView() {
  const { watchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist, mode, ready } = usePersonal();
  const { setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () =>
      watchlist.filter((slug) => {
        if (filter === "all") return true;
        return findBySlug(slug)?.region === filter;
      }),
    [watchlist, filter],
  );

  const { quotes, source } = useQuotes(watchlist);

  // A one-line summary of the list: how much of it is green, and by how much.
  const summary = useMemo(() => {
    const priced = quotes.filter((q): q is NonNullable<typeof q> => Boolean(q));
    if (priced.length === 0) return null;
    const advancing = priced.filter((q) => q.changePercent > 0).length;
    const mean = priced.reduce((s, q) => s + q.changePercent, 0) / priced.length;
    const best = priced.reduce((a, b) => (b.changePercent > a.changePercent ? b : a));
    const worst = priced.reduce((a, b) => (b.changePercent < a.changePercent ? b : a));
    return { advancing, total: priced.length, mean, best, worst };
  }, [quotes]);

  const suggestions = useMemo(
    () => (query.trim() ? searchUniverse(query, 6).filter((i) => !watchlist.includes(i.slug)) : []),
    [query, watchlist],
  );

  return (
    <>
      <PageHeader
        eyebrow="Watchlist"
        title="What you're tracking"
        description={
          mode === "cloud"
            ? "Synced to your account. Changes appear on every device you're signed in on within moments."
            : "Saved on this device. Sign in and it follows you — including everything already here."
        }
        meta={
          <>
            <DataSourceNotice source={source} />
            <Badge tone="neutral">{watchlist.length} tracked</Badge>
            <Badge tone={mode === "cloud" ? "up" : "signal"}>
              {mode === "cloud" ? "Cloud sync" : "This device"}
            </Badge>
          </>
        }
        actions={
          <>
            <Segmented
              value={filter}
              onChange={setFilter}
              layoutIdSuffix="watchlist-filter"
              options={[
                { value: "all", label: "All" },
                { value: "IN", label: "India" },
                { value: "US", label: "US" },
              ]}
            />
            <Button variant="primary" size="md" icon={<IconSearch />} onClick={() => setOpen(true)}>
              Find symbol
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        {summary && (
          <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
            <SummaryCell
              label="Advancing"
              value={`${summary.advancing} / ${summary.total}`}
              tone={summary.advancing >= summary.total / 2 ? 1 : -1}
            />
            <SummaryCell
              label="Average move"
              value={formatPercent(summary.mean)}
              tone={summary.mean}
            />
            <SummaryCell
              label="Best"
              value={`${summary.best.symbol} ${formatPercent(summary.best.changePercent)}`}
              tone={summary.best.changePercent}
            />
            <SummaryCell
              label="Worst"
              value={`${summary.worst.symbol} ${formatPercent(summary.worst.changePercent)}`}
              tone={summary.worst.changePercent}
            />
          </div>
        )}

        {/* Quick add */}
        <Panel>
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add by ticker or company name…"
              leading={<IconPlus />}
              onKeyDown={(e) => {
                if (e.key === "Enter" && suggestions[0]) {
                  addToWatchlist(suggestions[0].slug);
                  setQuery("");
                }
                if (e.key === "Escape") setQuery("");
              }}
            />

            <AnimatePresence>
              {suggestions.length > 0 && (
                <motion.ul
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-sm border border-line-strong bg-ink-850 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]"
                >
                  {suggestions.map((inst) => (
                    <li key={inst.slug}>
                      <button
                        onClick={() => {
                          addToWatchlist(inst.slug);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-ink-800"
                      >
                        <IconStar className="h-3.5 w-3.5 shrink-0 text-ivory-40" />
                        <span className="num-mono text-[12px] text-ivory">{inst.symbol}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ivory-40">
                          {inst.name}
                        </span>
                        <Badge tone={inst.region === "IN" ? "india" : "usa"}>{inst.exchange}</Badge>
                      </button>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </Panel>

        <Panel flush>
          {ready && watchlist.length === 0 ? (
            <EmptyState
              icon={<IconStar />}
              title="Your watchlist is empty"
              description="Star any instrument from a table, a stock page, or the command palette. Nothing is lost if you're not signed in — it saves here and moves with you later."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="primary" size="md" onClick={() => setOpen(true)}>
                    Search instruments
                  </Button>
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => reorderWatchlist(DEFAULT_WATCHLIST)}
                  >
                    Use a starter set
                  </Button>
                </div>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title={`Nothing from ${filter === "IN" ? "India" : "the United States"}`}
              description="Switch the filter, or add an instrument from that market."
            />
          ) : (
            <QuoteTable symbols={visible} defaultSort="change" />
          )}
        </Panel>

        {watchlist.length > 0 && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] text-ivory-40">
              Prices stream while this tab is open. Ordering is by the column you sort on.
            </p>
            <Button
              variant="danger"
              size="sm"
              icon={<IconTrash />}
              onClick={() => {
                for (const slug of watchlist) removeFromWatchlist(slug);
              }}
            >
              Clear watchlist
            </Button>
          </div>
        )}
      </PageBody>
    </>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone: number }) {
  return (
    <div className="bg-ink-900 p-4">
      <p className="label-micro text-ivory-40">{label}</p>
      <p
        className={cn(
          "num-mono mt-2.5 text-[15px] tracking-tight",
          tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </p>
    </div>
  );
}
