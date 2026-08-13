"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, EmptyState, Panel, PanelHeader, Segmented, Skeleton } from "@/components/ui/primitives";
import { IconClock, IconRefresh, IconStar } from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Corporate actions.
 *
 * The reason this deserves a page: an ex-dividend date looks exactly like a
 * sudden drop on a chart, and a 10:1 split looks like a crash. Knowing one is
 * coming is the difference between reading a price correctly and panicking at
 * it. Almost nothing consumer-facing surfaces this for the Indian market.
 */

interface Action {
  symbol: string;
  slug: string | null;
  company: string;
  subject: string;
  kind: "dividend" | "split" | "bonus" | "rights" | "buyback" | "meeting" | "other";
  value: number | null;
  ratio: string | null;
  exDate: string;
  recordDate: string | null;
  series: string;
  faceValue: number | null;
}

type Filter = "all" | "dividend" | "split" | "bonus" | "watchlist";

const KIND_TONE: Record<Action["kind"], "up" | "signal" | "usa" | "neutral" | "crypto"> = {
  dividend: "up",
  split: "signal",
  bonus: "crypto",
  rights: "usa",
  buyback: "signal",
  meeting: "neutral",
  other: "neutral",
};

export function ActionsView() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [days, setDays] = useState(30);
  const { watchlist } = usePersonal();

  const load = async (window: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/corporate-actions?days=${window}`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { data: Action[]; notice?: string };
        setActions(body.data);
        setNotice(body.notice ?? null);
      }
    } catch {
      /* empty state covers it */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(days);
  }, [days]);

  const watched = useMemo(() => new Set(watchlist), [watchlist]);

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (filter === "watchlist") return a.slug != null && watched.has(a.slug);
      if (filter !== "all") return a.kind === filter;
      return true;
    });
  }, [actions, filter, watched]);

  /** Grouped by ex-date, watched names first inside each day. */
  const grouped = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const a of filtered) {
      const list = map.get(a.exDate);
      if (list) list.push(a);
      else map.set(a.exDate, [a]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aw = a.slug != null && watched.has(a.slug);
        const bw = b.slug != null && watched.has(b.slug);
        if (aw !== bw) return aw ? -1 : 1;
        if (Boolean(a.slug) !== Boolean(b.slug)) return a.slug ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, watched]);

  const watchedCount = actions.filter((a) => a.slug != null && watched.has(a.slug)).length;

  return (
    <>
      <PageHeader
        eyebrow="India · corporate actions"
        title="Dividends, splits and bonuses"
        description="A stock going ex-dividend looks exactly like a sudden drop on a chart. A ten-for-one split looks like a crash. Here is what is coming, so neither surprises you."
        meta={
          <>
            <Badge tone="neutral">{filtered.length} upcoming</Badge>
            {watchedCount > 0 && <Badge tone="signal">{watchedCount} on your watchlist</Badge>}
          </>
        }
        actions={
          <>
            <Segmented
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              layoutIdSuffix="ca-window"
              options={[
                { value: "14", label: "2w" },
                { value: "30", label: "1m" },
                { value: "60", label: "2m" },
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
            layoutIdSuffix="ca-filter"
            options={[
              { value: "all", label: "Everything" },
              { value: "watchlist", label: "My watchlist" },
              { value: "dividend", label: "Dividends" },
              { value: "split", label: "Splits" },
              { value: "bonus", label: "Bonuses" },
            ]}
          />
        </Panel>

        {loading && actions.length === 0 ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <Panel key={i} flush>
                <div className="border-b border-line px-4 py-3">
                  <Skeleton className="h-3 w-32" />
                </div>
                <div className="space-y-3 p-4">
                  {[0, 1].map((j) => (
                    <Skeleton key={j} className="h-9 w-full" />
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<IconClock />}
              title="Nothing scheduled"
              description={
                notice ??
                (filter === "watchlist"
                  ? "None of the instruments you track have an action in this window."
                  : "No corporate actions fall in this window.")
              }
              action={
                <Button variant="secondary" size="md" onClick={() => load(days)}>
                  Try again
                </Button>
              }
            />
          </Panel>
        ) : (
          grouped.map(([date, rows], gi) => (
            <motion.div
              key={date}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(gi * 0.04, 0.3) }}
            >
              <Panel flush>
                <PanelHeader
                  title={formatDate(date)}
                  subtitle={`Ex-date · ${relativeDay(date)}`}
                  action={<Badge tone="neutral">{rows.length}</Badge>}
                />
                <ul className="divide-y divide-line/60">
                  {rows.map((a, i) => (
                    <ActionRow
                      key={`${a.symbol}-${a.subject}-${i}`}
                      action={a}
                      watched={a.slug != null && watched.has(a.slug)}
                    />
                  ))}
                </ul>
              </Panel>
            </motion.div>
          ))
        )}

        <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
          The ex-date is the first session a buyer no longer receives the entitlement, and
          the price adjusts down by roughly the dividend that morning. That adjustment is
          not a loss — it is the cash leaving the company.
        </p>
      </PageBody>
    </>
  );
}

function ActionRow({ action, watched }: { action: Action; watched: boolean }) {
  const detail =
    action.kind === "dividend" && action.value != null
      ? `${formatPrice(action.value, "INR")} per share`
      : action.ratio
        ? `${action.ratio}`
        : action.subject;

  const body = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="h-6 w-[2px] shrink-0 rounded-full bg-india opacity-70" />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="num-mono text-[12px] font-medium text-ivory">{action.symbol}</span>
            {watched && <IconStar className="h-3 w-3 shrink-0 text-signal" />}
            <Badge tone={KIND_TONE[action.kind]}>{action.kind}</Badge>
          </span>
          <span className="mt-0.5 block max-w-[38ch] truncate text-[11px] text-ivory-40">
            {action.company}
          </span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-5 text-right">
        <span>
          <span className="label-micro block text-ivory-40">
            {action.kind === "dividend" ? "Amount" : "Ratio"}
          </span>
          <span className="num-mono mt-0.5 block max-w-[22ch] truncate text-[12px] text-ivory">
            {detail}
          </span>
        </span>
        {action.recordDate && (
          <span className="hidden sm:block">
            <span className="label-micro block text-ivory-40">Record</span>
            <span className="num-mono mt-0.5 block text-[11px] text-ivory-60">
              {formatDate(action.recordDate)}
            </span>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <li className={cn("transition-colors", action.slug && "hover:bg-ink-850")}>
      {action.slug ? (
        <Link href={`/stock/${encodeURIComponent(action.slug)}`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function relativeDay(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return `In ${diff} days`;
  return `In ${Math.round(diff / 7)} week${diff >= 14 ? "s" : ""}`;
}
