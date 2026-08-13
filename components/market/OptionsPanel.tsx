"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import type { MaxPainResult, OiRow, OptionChain, OptionsSummary } from "@/lib/analytics/options";
import { Badge, EmptyState, Panel, PanelHeader, Segmented, Skeleton, Tooltip } from "@/components/ui/primitives";
import { IconLayers } from "@/components/ui/icons";
import { formatCompact, formatDate, formatPercent, formatPrice } from "@/lib/format";
import type { Currency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The options view.
 *
 * A chain is a wall of numbers; what a reader wants from it is structure —
 * where the open interest is stacked, where price would hurt the most people
 * least, and whether positioning leans long or short. Those are surfaced
 * first, and the strike ladder sits underneath for anyone who wants the detail.
 */

interface OptionsPayload {
  chain: OptionChain;
  maxPain: MaxPainResult | null;
  profile: OiRow[];
  summary: OptionsSummary;
}

export function OptionsPanel({
  slug,
  currency,
  className,
}: {
  slug: string;
  currency: Currency;
  className?: string;
}) {
  const [data, setData] = useState<OptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const params = new URLSearchParams({ symbol: slug });
        if (expiry) params.set("expiry", String(expiry));

        const res = await fetch(`/api/options?${params}`, { signal: controller.signal });
        const body = (await res.json()) as { data?: OptionsPayload; error?: string };
        if (cancelled) return;

        if (body.data) {
          setData(body.data);
          setMessage(null);
        } else {
          setData(null);
          setMessage(body.error ?? "No option chain available.");
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setMessage("Could not load the option chain.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, expiry]);

  if (loading && !data) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Options" subtitle="Open interest and positioning" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Options" subtitle="Open interest and positioning" />
        <EmptyState icon={<IconLayers />} title="Not available" description={message ?? undefined} />
      </Panel>
    );
  }

  const { chain, maxPain, profile, summary } = data;

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Options"
        subtitle={`Expiring ${formatDate(chain.expiry)} · ${summary.daysToExpiry} day${summary.daysToExpiry === 1 ? "" : "s"} out`}
        action={
          chain.expiries.length > 1 && (
            <Segmented
              value={String(chain.expiry)}
              onChange={(v) => setExpiry(Number(v))}
              layoutIdSuffix="opt-expiry"
              options={chain.expiries.slice(0, 5).map((e) => ({
                value: String(e),
                label: formatDate(e).slice(0, 6),
                title: formatDate(e),
              }))}
            />
          )
        }
      />

      {/* Headline reads */}
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <Cell
          label="Max pain"
          hint="The strike at which the total intrinsic value of all open contracts is smallest — where option writers pay out least. Read it as where open interest is concentrated, not as a forecast."
          value={maxPain ? formatPrice(maxPain.strike, currency) : "—"}
          sub={maxPain ? `${formatPercent(maxPain.distancePercent)} from spot` : undefined}
          tone={maxPain ? maxPain.distancePercent : undefined}
        />
        <Cell
          label="Put / call ratio"
          hint="Put open interest divided by call open interest. Above 1 means more puts are open than calls."
          value={summary.putCallRatio.toFixed(2)}
          sub={
            summary.putCallRatio > 1
              ? "More puts open"
              : summary.putCallRatio < 1
                ? "More calls open"
                : "Balanced"
          }
        />
        <Cell
          label="Implied volatility"
          hint="At-the-money implied volatility, annualised. What the options market expects the price to do between now and expiry."
          value={summary.atmIv != null ? `${summary.atmIv.toFixed(1)}%` : "—"}
          sub="At the money"
        />
      </div>

      <p className="border-y border-line bg-ink-950/40 px-4 py-3 text-[12px] leading-relaxed text-ivory-60">
        {summary.interpretation}
      </p>

      {/* Open interest ladder */}
      <div className="p-4">
        <p className="label-micro mb-3 text-ivory-40">
          Open interest by strike · calls left, puts right
        </p>
        <OiLadder rows={profile} spot={chain.spot} currency={currency} maxPain={maxPain?.strike} />
      </div>

      {(summary.maxCallOiStrike || summary.maxPutOiStrike) && (
        <div className="border-t border-line p-4">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {summary.maxPutOiStrike != null && (
              <Level
                label="Heaviest put strike"
                value={formatPrice(summary.maxPutOiStrike, currency)}
                note="Where the most puts are written. Often talked about as a floor, because writers defend it."
                tone="up"
              />
            )}
            {summary.maxCallOiStrike != null && (
              <Level
                label="Heaviest call strike"
                value={formatPrice(summary.maxCallOiStrike, currency)}
                note="Where the most calls are written. Often talked about as a ceiling for the same reason."
                tone="down"
              />
            )}
          </dl>
        </div>
      )}
    </Panel>
  );
}

/* ── Ladder ───────────────────────────────────────────────────────────────── */

function OiLadder({
  rows,
  spot,
  currency,
  maxPain,
}: {
  rows: OiRow[];
  spot: number;
  currency: Currency;
  maxPain?: number;
}) {
  const peak = useMemo(
    () => Math.max(1, ...rows.map((r) => Math.max(r.callOi, r.putOi))),
    [rows],
  );

  if (rows.length === 0) {
    return <p className="text-[12px] text-ivory-40">No open interest on this expiry.</p>;
  }

  return (
    <div className="space-y-[3px]">
      {rows.map((row, i) => {
        const callPct = (row.callOi / peak) * 100;
        const putPct = (row.putOi / peak) * 100;
        const isPain = maxPain != null && Math.abs(row.strike - maxPain) < 0.001;
        const nearSpot = row.atTheMoney;

        return (
          <div
            key={row.strike}
            className={cn(
              "grid grid-cols-[1fr_86px_1fr] items-center gap-2 rounded-[3px] px-1 py-0.5",
              nearSpot && "bg-signal/[0.07]",
            )}
          >
            {/* Calls grow leftward from the centre. */}
            <div className="flex justify-end">
              <motion.div
                className="h-3.5 rounded-l-[2px] bg-down/55"
                initial={{ width: 0 }}
                animate={{ width: `${callPct}%` }}
                transition={{ duration: 0.5, delay: Math.min(i * 0.02, 0.25) }}
                title={`${formatCompact(row.callOi, currency)} call OI`}
              />
            </div>

            <div className="flex items-center justify-center gap-1.5">
              <span
                className={cn(
                  "num-mono text-[11px]",
                  nearSpot ? "text-signal" : isPain ? "text-ivory" : "text-ivory-60",
                )}
              >
                {row.strike.toLocaleString(currency === "INR" ? "en-IN" : "en-US")}
              </span>
              {isPain && (
                <Tooltip content="Max pain strike">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                </Tooltip>
              )}
            </div>

            <div className="flex justify-start">
              <motion.div
                className="h-3.5 rounded-r-[2px] bg-up/55"
                initial={{ width: 0 }}
                animate={{ width: `${putPct}%` }}
                transition={{ duration: 0.5, delay: Math.min(i * 0.02, 0.25) }}
                title={`${formatCompact(row.putOi, currency)} put OI`}
              />
            </div>
          </div>
        );
      })}

      <div className="mt-3 flex items-center justify-between text-[10px] text-ivory-40">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[1px] bg-down/55" /> Calls
        </span>
        <span className="num-mono">Spot {formatPrice(spot, currency)}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-[1px] bg-up/55" /> Puts
        </span>
      </div>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Cell({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  hint: string;
  tone?: number;
}) {
  return (
    <div className="bg-ink-900 p-4">
      <Tooltip content={hint}>
        <p className="label-micro cursor-help border-b border-dotted border-line-strong text-ivory-40">
          {label}
        </p>
      </Tooltip>
      <p
        className={cn(
          "num-mono mt-2.5 text-[20px] leading-none tracking-tight",
          tone == null ? "text-ivory" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-[11px] text-ivory-40">{sub}</p>}
    </div>
  );
}

function Level({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "up" | "down";
}) {
  return (
    <div>
      <dt className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-[1px]", tone === "up" ? "bg-up" : "bg-down")} />
        <span className="label-micro text-ivory-40">{label}</span>
      </dt>
      <dd className="num-mono mt-1.5 pl-4 text-[14px] text-ivory">{value}</dd>
      <p className="mt-1 pl-4 text-[11px] leading-relaxed text-ivory-40">{note}</p>
    </div>
  );
}
