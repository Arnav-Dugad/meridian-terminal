"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";

import type { OverviewPayload } from "@/lib/twelvedata/overview";
import type { IndexSeed } from "@/components/market/IndexStrip";
import { IndexStrip } from "@/components/market/IndexStrip";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { BreadthMeter } from "@/components/market/BreadthMeter";
import { SectorRotation } from "@/components/market/SectorRotation";
import { SessionDial } from "@/components/market/SessionDial";
import { QuoteTable } from "@/components/market/QuoteTable";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { Badge, Button, Panel, PanelHeader, Segmented, EmptyState } from "@/components/ui/primitives";
import { NewsPanel } from "@/components/market/NewsFeed";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { formatPercent, formatPrice, formatRelative } from "@/lib/format";
import { DEFAULT_WATCHLIST } from "@/lib/market/universe";
import { IconArrowRight, IconRefresh, IconStar } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type MoverTab = "gainers" | "losers" | "active";

export function DashboardView({
  overview,
  seeds,
}: {
  overview: OverviewPayload;
  seeds: IndexSeed[];
}) {
  const { watchlist, ready } = usePersonal();
  const [moverTab, setMoverTab] = useState<MoverTab>("gainers");

  const moverSymbols = useMemo(
    () => overview.movers[moverTab].map((q) => q.slug),
    [overview.movers, moverTab],
  );

  const watchSymbols = watchlist.length > 0 ? watchlist : DEFAULT_WATCHLIST;
  const { refresh, connected, updatedAt } = useQuotes(watchSymbols.slice(0, 8));

  // A one-line read of what the two markets are doing relative to each other.
  const spread = overview.breadth.IN.weightedChange - overview.breadth.US.weightedChange;

  return (
    <>
      <PageHeader
        eyebrow="Cross-market overview"
        title={greeting()}
        description={narrative(overview, spread)}
        meta={
          <>
            <DataSourceNotice source={overview.source} notice={overview.notice} />
            <Badge tone={connected ? "up" : "neutral"}>
              {connected ? "Streaming" : "Polling"}
            </Badge>
            <span className="text-[11px] text-ivory-40">
              Updated {updatedAt ? formatRelative(updatedAt) : formatRelative(overview.asOf)}
            </span>
          </>
        }
        actions={
          <>
            {overview.fx && (
              <div className="hidden items-baseline gap-2 rounded-sm border border-line bg-ink-900 px-3 py-2 sm:flex">
                <span className="label-micro text-ivory-40">USD/INR</span>
                <span className="num-mono text-[13px] text-ivory">
                  <AnimatedNumber value={overview.fx.rate} format={(v) => v.toFixed(3)} feel="soft" />
                </span>
              </div>
            )}
            <Button variant="outline" size="md" icon={<IconRefresh />} onClick={refresh}>
              Refresh
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4 sm:space-y-5">
        {/* Index rail */}
        <IndexStrip seeds={seeds} columns={3} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />

        {/* Crypto rail — the one market still open when both others are dark. */}
        {overview.crypto.length > 0 && (
          <Panel flush>
            <PanelHeader
              title="Digital assets"
              subtitle="Always trading"
              action={
                <Link href="/markets">
                  <Button variant="ghost" size="sm" icon={<IconArrowRight />}>
                    Markets
                  </Button>
                </Link>
              }
            />
            <QuoteTable
              symbols={overview.crypto.slice(0, 6).map((q) => q.slug)}
              defaultSort="change"
              compact
            />
          </Panel>
        )}

        <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_356px]">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4 sm:space-y-5">
            {/* Breadth */}
            <Panel flush>
              <PanelHeader
                title="Market breadth"
                subtitle="Participation behind the headline index move"
              />
              <div className="grid gap-7 p-4 sm:grid-cols-2 sm:gap-8 sm:p-5">
                <BreadthMeter breadth={overview.breadth.IN} />
                <BreadthMeter breadth={overview.breadth.US} />
              </div>
            </Panel>

            {/* Sector rotation */}
            <Panel flush>
              <PanelHeader
                title="Sector rotation"
                subtitle="Both markets on one scale — where capital is moving today"
              />
              <div className="py-3">
                <SectorRotation sectors={overview.sectors} />
              </div>
            </Panel>

            {/* Movers */}
            <Panel flush>
              <PanelHeader
                title="Movers"
                subtitle="Across the largest names in both markets"
                action={
                  <Segmented
                    value={moverTab}
                    onChange={setMoverTab}
                    layoutIdSuffix="movers"
                    options={[
                      { value: "gainers", label: "Gainers" },
                      { value: "losers", label: "Losers" },
                      { value: "active", label: "Most traded" },
                    ]}
                  />
                }
              />
              <motion.div key={moverTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <QuoteTable symbols={moverSymbols} compact />
              </motion.div>
            </Panel>
          </div>

          {/* ── Right column ────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4 sm:space-y-5">
            <Panel>
              <p className="label-micro mb-5 text-ivory-40">Sessions</p>
              <SessionDial compact className="justify-center" />
              <div className="mt-5 space-y-2.5 border-t border-line pt-4">
                {overview.sessions
                  .filter((s) => s.code === "NSE" || s.code === "NASDAQ")
                  .map((s) => (
                    <div key={s.code} className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-ivory-60">{s.code}</span>
                      <span
                        className={cn(
                          "label-micro-tight",
                          s.isLive ? "text-up" : s.phase === "pre" ? "text-signal" : "text-ivory-40",
                        )}
                      >
                        {s.label} · {s.localTime}
                      </span>
                    </div>
                  ))}
              </div>
            </Panel>

            {/* Cross-market spread */}
            <Panel>
              <p className="label-micro text-ivory-40">India minus US</p>
              <p
                className={cn(
                  "num-mono mt-3 text-[30px] leading-none tracking-tight",
                  spread > 0 ? "text-up" : spread < 0 ? "text-down" : "text-ivory",
                )}
              >
                <AnimatedNumber value={spread} format={(v) => formatPercent(v)} feel="soft" />
              </p>
              <p className="mt-3.5 text-[12px] leading-relaxed text-ivory-40">
                Cap-weighted move of the Indian sample less the US sample.{" "}
                {Math.abs(spread) < 0.2
                  ? "The two markets are moving together today."
                  : spread > 0
                    ? "India is outperforming — worth checking whether it holds once New York opens."
                    : "The US is leading; India has yet to close that gap."}
              </p>
            </Panel>

            {/* Watchlist preview */}
            <Panel flush>
              <PanelHeader
                title="Your watchlist"
                subtitle={
                  watchlist.length === 0 ? "Showing a starter set" : `${watchlist.length} instruments`
                }
                action={
                  <Link href="/watchlist">
                    <Button variant="ghost" size="sm" icon={<IconArrowRight />}>
                      All
                    </Button>
                  </Link>
                }
              />
              {ready && watchSymbols.length === 0 ? (
                <EmptyState
                  icon={<IconStar />}
                  title="Nothing tracked yet"
                  description="Star an instrument anywhere in the terminal and it will appear here."
                />
              ) : (
                <CompactWatchlist symbols={watchSymbols.slice(0, 7)} />
              )}
            </Panel>

            <NewsPanel
              slug={null}
              limit={5}
              title="Headlines"
              subtitle="Market-wide"
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function CompactWatchlist({ symbols }: { symbols: string[] }) {
  const { quotes } = useQuotes(symbols);

  return (
    <ul className="divide-y divide-line/60">
      {symbols.map((slug, i) => {
        const quote = quotes[i];
        return (
          <li key={slug}>
            <Link
              href={`/stock/${encodeURIComponent(slug)}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-ink-850"
            >
              <span className="num-mono min-w-0 truncate text-[12px] text-ivory">
                {quote?.symbol ?? slug}
              </span>
              <span className="flex shrink-0 items-baseline gap-2.5">
                <span className="num-mono text-[12px] text-ivory-80">
                  {quote ? formatPrice(quote.price, quote.currency) : "—"}
                </span>
                <span
                  className={cn(
                    "num-mono w-[54px] text-right text-[11px]",
                    (quote?.changePercent ?? 0) > 0
                      ? "text-up"
                      : (quote?.changePercent ?? 0) < 0
                        ? "text-down"
                        : "text-ivory-40",
                  )}
                >
                  {quote ? formatPercent(quote.changePercent) : "—"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good evening";
}

/**
 * A one-sentence read of the tape.
 *
 * Written from the numbers rather than pulled from a template list, so it says
 * something specific: which market is open, whether breadth confirms the index,
 * and where the two markets diverge.
 */
function narrative(overview: OverviewPayload, spread: number): string {
  const nse = overview.sessions.find((s) => s.code === "NSE");
  const us = overview.sessions.find((s) => s.code === "NASDAQ");

  const openNow =
    nse?.isLive && us?.isLive
      ? "Both markets are trading."
      : nse?.isLive
        ? "India is trading; the US opens later."
        : us?.isLive
          ? "The US is trading; India has closed."
          : "Both markets are closed.";

  const inBreadth = overview.breadth.IN;
  const usBreadth = overview.breadth.US;

  const leader = spread > 0 ? "India" : "the US";
  const leadStrength = Math.abs(spread) < 0.2 ? "in line with" : "ahead of";
  const laggard = spread > 0 ? "the US" : "India";

  const participation =
    inBreadth.ratio > 0.65 || usBreadth.ratio > 0.65
      ? "Breadth is broad."
      : inBreadth.ratio < 0.35 || usBreadth.ratio < 0.35
        ? "Breadth is narrow — the move is concentrated."
        : "Breadth is mixed.";

  return `${openNow} ${leader} is trading ${leadStrength} ${laggard} on a cap-weighted basis. ${participation}`;
}
