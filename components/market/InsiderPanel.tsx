"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

import { Badge, EmptyState, Panel, PanelHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { IconUser } from "@/components/ui/icons";
import { formatCompactMoney, formatDate, formatNumber } from "@/lib/format";
import type { Currency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Insider filings.
 *
 * The framing matters as much as the data. Insider *selling* is close to
 * meaningless on its own — options vest and executives diversify on schedules
 * fixed months in advance — while open-market *buying* is rare and costly and
 * therefore informative. So grants, gifts and option exercises are separated
 * from open-market trades rather than being totalled together, which is how
 * this data is usually misread.
 */

interface InsiderTrade {
  name: string;
  shares: number;
  direction: "buy" | "sell";
  openMarket: boolean;
  code: string | null;
  price: number | null;
  value: number | null;
  filedAt: number | null;
  transactedAt: number | null;
}

interface Summary {
  netShares: number;
  buyCount: number;
  sellCount: number;
  openMarketBuyValue: number;
  openMarketSellValue: number;
  interpretation: string;
}

const CODE_LABEL: Record<string, string> = {
  P: "Open-market purchase",
  S: "Open-market sale",
  A: "Grant or award",
  M: "Option exercise",
  G: "Gift",
  F: "Tax withholding",
  C: "Conversion",
};

export function InsiderPanel({
  slug,
  currency,
  className,
}: {
  slug: string;
  currency: Currency;
  className?: string;
}) {
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/insiders?symbol=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        const body = (await res.json()) as {
          data: InsiderTrade[];
          summary?: Summary;
          notice?: string;
        };
        if (cancelled) return;
        setTrades(body.data);
        setSummary(body.summary ?? null);
        setNotice(body.notice ?? null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setNotice("Insider filings could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  if (loading) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Insider activity" />
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  if (trades.length === 0) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Insider activity" />
        <EmptyState
          icon={<IconUser />}
          title="No filings available"
          description={notice ?? "No insider transactions have been filed for this company recently."}
        />
      </Panel>
    );
  }

  const openMarket = trades.filter((t) => t.openMarket);

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Insider activity"
        subtitle="Officers and directors, as filed"
        action={
          summary && (
            <Badge tone={summary.openMarketBuyValue > summary.openMarketSellValue ? "up" : "neutral"}>
              {summary.buyCount} bought · {summary.sellCount} sold
            </Badge>
          )
        }
      />

      {summary && (
        <>
          <div className="grid gap-px bg-line sm:grid-cols-2">
            <Cell
              label="Open-market buying"
              value={formatCompactMoney(summary.openMarketBuyValue, currency)}
              tone={summary.openMarketBuyValue > 0 ? 1 : 0}
              sub={`${summary.buyCount} purchase${summary.buyCount === 1 ? "" : "s"}`}
            />
            <Cell
              label="Open-market selling"
              value={formatCompactMoney(summary.openMarketSellValue, currency)}
              tone={summary.openMarketSellValue > 0 ? -1 : 0}
              sub={`${summary.sellCount} sale${summary.sellCount === 1 ? "" : "s"}`}
            />
          </div>

          <p className="border-y border-line bg-ink-950/40 px-4 py-3 text-[12px] leading-relaxed text-ivory-60">
            {summary.interpretation}
          </p>
        </>
      )}

      <ul className="divide-y divide-line/60">
        {trades.slice(0, 12).map((t, i) => (
          <motion.li
            key={`${t.name}-${t.transactedAt}-${i}`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28, delay: Math.min(i * 0.03, 0.25) }}
            className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5")}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-ivory">{titleCase(t.name)}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[10px] text-ivory-40">
                {t.transactedAt ? formatDate(t.transactedAt) : "—"}
                {t.code && (
                  <Tooltip content={CODE_LABEL[t.code] ?? `Form 4 code ${t.code}`}>
                    <span className="cursor-help border-b border-dotted border-line-strong">
                      {CODE_LABEL[t.code] ?? t.code}
                    </span>
                  </Tooltip>
                )}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-4 text-right">
              <span className="num-mono text-[11px] text-ivory-60">
                {formatNumber(t.shares, currency)}
              </span>
              <span
                className={cn(
                  "label-micro-tight w-[38px] rounded-[3px] px-1.5 py-1 text-center",
                  !t.openMarket
                    ? "bg-ink-750 text-ivory-40"
                    : t.direction === "buy"
                      ? "bg-up/12 text-up"
                      : "bg-down/12 text-down",
                )}
              >
                {t.direction === "buy" ? "BUY" : "SELL"}
              </span>
              <span
                className={cn(
                  "num-mono w-[74px] text-right text-[11px]",
                  t.openMarket
                    ? t.direction === "buy"
                      ? "text-up"
                      : "text-down"
                    : "text-ivory-40",
                )}
              >
                {t.value != null ? formatCompactMoney(t.value, currency) : "—"}
              </span>
            </div>
          </motion.li>
        ))}
      </ul>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Greyed rows are grants, gifts, option exercises and tax withholding — transfers
        rather than decisions to buy or sell, and they carry no directional signal.{" "}
        {openMarket.length === 0
          ? "None of the recent filings here are open-market trades."
          : `${openMarket.length} of these ${trades.length} filings are open-market trades.`}
      </p>
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
  sub: string;
  tone: number;
}) {
  return (
    <div className="bg-ink-900 p-4">
      <p className="label-micro text-ivory-40">{label}</p>
      <p
        className={cn(
          "num-mono mt-2.5 text-[18px] leading-none tracking-tight",
          tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory-60",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[11px] text-ivory-40">{sub}</p>
    </div>
  );
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
