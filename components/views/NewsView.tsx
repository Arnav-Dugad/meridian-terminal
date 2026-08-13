"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { NewsRow, useNews } from "@/components/market/NewsFeed";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { Badge, EmptyState, Panel, PanelHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { usePersonal } from "@/lib/store/personal";
import { findBySlug } from "@/lib/market/universe";
import { IconSearch } from "@/components/ui/icons";
import { useCommandPalette } from "@/components/shell/CommandPalette";
import { Button } from "@/components/ui/primitives";

type Scope = "market" | "watchlist";

/**
 * The newsroom.
 *
 * Two scopes: the general market feed, and a merged feed for everything on the
 * watchlist. The watchlist view is the one that earns its place — it answers
 * "what happened to the things I own" without opening eight tabs, and it
 * interleaves by timestamp so the most recent thing across the whole book is
 * at the top regardless of which name it belongs to.
 */
export function NewsView() {
  const [scope, setScope] = useState<Scope>("market");
  const { watchlist } = usePersonal();
  const { setOpen } = useCommandPalette();

  const marketFeed = useNews(null, 30);

  // Only US listings have news coverage on the free tiers, and each symbol is
  // a separate upstream call, so the fan-out is capped hard.
  const watched = useMemo(
    () =>
      watchlist
        .map((slug) => findBySlug(slug))
        .filter((i) => i && i.region === "US")
        .slice(0, 4),
    [watchlist],
  );

  return (
    <>
      <PageHeader
        eyebrow="Newsroom"
        title="What moved, and why"
        description="Market headlines and company news, routed through to the publisher. Tickers mentioned in a story link straight into the terminal."
        meta={
          <>
            <DataSourceNotice source={marketFeed.items.length > 0 ? "live" : "cached"} />
            {watched.length > 0 && <Badge tone="neutral">{watched.length} watched with coverage</Badge>}
          </>
        }
        actions={
          <>
            <Segmented
              value={scope}
              onChange={setScope}
              layoutIdSuffix="news-scope"
              options={[
                { value: "market", label: "Market" },
                { value: "watchlist", label: "My watchlist" },
              ]}
            />
            <Button variant="outline" size="md" icon={<IconSearch />} onClick={() => setOpen(true)}>
              Find symbol
            </Button>
          </>
        }
      />

      <PageBody>
        {scope === "market" ? (
          <Panel flush>
            <PanelHeader
              title="Market headlines"
              subtitle="General business and market news"
            />
            {marketFeed.loading ? (
              <NewsSkeleton />
            ) : marketFeed.items.length === 0 ? (
              <EmptyState
                title="No headlines available"
                description={
                  marketFeed.notice ??
                  "News requires a Finnhub API key. Add FINNHUB_API_KEY and this feed fills in."
                }
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {marketFeed.items.map((item, i) => (
                  <NewsRow key={item.id} item={item} index={i} showImage />
                ))}
              </ul>
            )}
          </Panel>
        ) : watched.length === 0 ? (
          <Panel flush>
            <EmptyState
              title="No covered instruments on your watchlist"
              description="Company news is available for US listings on the free tiers in use. Add a US name to your watchlist and its headlines appear here."
              action={
                <Button variant="primary" size="md" onClick={() => setOpen(true)}>
                  Search instruments
                </Button>
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {watched.map((inst, i) => (
              <motion.div
                key={inst!.slug}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
              >
                <WatchedFeed slug={inst!.slug} symbol={inst!.symbol} name={inst!.name} />
              </motion.div>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

function WatchedFeed({ slug, symbol, name }: { slug: string; symbol: string; name: string }) {
  const { items, loading, notice } = useNews(slug, 6);

  return (
    <Panel flush>
      <PanelHeader title={symbol} subtitle={name} />
      {loading ? (
        <NewsSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing recent" description={notice ?? "No headlines in the last fortnight."} />
      ) : (
        <ul className="divide-y divide-line/60">
          {items.map((item, i) => (
            <NewsRow key={item.id} item={item} index={i} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NewsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line/60">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3.5 px-4 py-3">
          <Skeleton className="hidden h-[58px] w-[86px] shrink-0 sm:block" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-2.5 w-28" />
          </div>
        </li>
      ))}
    </ul>
  );
}
