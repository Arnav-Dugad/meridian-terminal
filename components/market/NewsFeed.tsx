"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import type { NewsItem } from "@/lib/providers/types";
import { formatRelative } from "@/lib/format";
import { EmptyState, Panel, PanelHeader, Skeleton, Badge } from "@/components/ui/primitives";
import { IconExternal } from "@/components/ui/icons";
import { findBySymbol } from "@/lib/market/universe";
import { cn } from "@/lib/utils";

/**
 * News.
 *
 * Two decisions worth naming. Headlines link straight out to the publisher
 * rather than opening a reader view — a terminal's job is to route you to the
 * source, not to intermediate it. And tickers mentioned in an item become
 * links into the terminal, which is what turns a feed into navigation instead
 * of a wall of text.
 */

export function useNews(slug: string | null, limit = 20) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (slug) params.set("symbol", slug);

        const res = await fetch(`/api/news?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`news ${res.status}`);

        const body = (await res.json()) as { data: NewsItem[]; notice?: string };
        if (cancelled) return;
        setItems(body.data);
        setNotice(body.notice ?? null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setItems([]);
        setNotice("Could not load news.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, limit]);

  return { items, loading, notice };
}

export function NewsPanel({
  slug,
  limit = 8,
  title = "News",
  subtitle,
  showImages = false,
}: {
  slug: string | null;
  limit?: number;
  title?: string;
  subtitle?: string;
  showImages?: boolean;
}) {
  const { items, loading, notice } = useNews(slug, limit);

  return (
    <Panel flush>
      <PanelHeader
        title={title}
        subtitle={subtitle}
        action={items.length > 0 ? <Badge tone="neutral">{items.length}</Badge> : undefined}
      />

      {loading ? (
        <ul className="divide-y divide-line/60">
          {Array.from({ length: Math.min(4, limit) }, (_, i) => (
            <li key={i} className="space-y-2 px-4 py-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-2.5 w-24" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState
          title="No news available"
          description={
            notice ??
            "Company news is provided by Finnhub, whose free tier covers US listings."
          }
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {items.map((item, i) => (
            <NewsRow key={item.id} item={item} index={i} showImage={showImages} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function NewsRow({
  item,
  index,
  showImage = false,
}: {
  item: NewsItem;
  index: number;
  showImage?: boolean;
}) {
  // Only link tickers the terminal can actually open.
  const tickers = useMemo(
    () =>
      item.symbols
        .slice(0, 4)
        .map((symbol) => ({ symbol, instrument: findBySymbol(symbol) }))
        .filter((t) => t.instrument),
    [item.symbols],
  );

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.035, 0.3) }}
      className="group transition-colors hover:bg-ink-850"
    >
      <div className="flex gap-3.5 px-4 py-3">
        {showImage && item.imageUrl && (
          <div className="hidden h-[58px] w-[86px] shrink-0 overflow-hidden rounded-sm bg-ink-800 sm:block">
            {/* Publisher thumbnails come from arbitrary hosts, so this stays a
                plain <img>: next/image would need every domain allow-listed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[13px] leading-snug text-ivory transition-colors group-hover:text-signal"
          >
            {item.headline}
            <IconExternal className="ml-1.5 inline h-3 w-3 align-[-1px] opacity-0 transition-opacity group-hover:opacity-60" />
          </a>

          {item.summary && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ivory-40">
              {item.summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="label-micro-tight text-ivory-40">{item.source}</span>
            <span className="text-ivory-25">·</span>
            <span className="num-mono text-[10px] text-ivory-40">
              {formatRelative(item.publishedAt)}
            </span>

            {tickers.length > 0 && (
              <>
                <span className="text-ivory-25">·</span>
                {tickers.map(({ symbol, instrument }) => (
                  <Link
                    key={symbol}
                    href={`/stock/${encodeURIComponent(instrument!.slug)}`}
                    className={cn(
                      "num-mono rounded-[3px] border border-line px-1.5 py-px text-[10px] transition-colors",
                      "text-ivory-60 hover:border-line-bright hover:text-ivory",
                    )}
                  >
                    {symbol}
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </motion.li>
  );
}
