"use client";

import { motion } from "motion/react";

import type { Ownership, RatingChange } from "@/lib/providers/yahoo-summary";
import { Badge, EmptyState, Panel, PanelHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { IconUser } from "@/components/ui/icons";
import { formatCompactMoney, formatDate, formatRelative } from "@/lib/format";
import type { Currency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Who owns it, and who changed their mind.
 *
 * Ownership concentration is one of the few structural facts about a company
 * that a price chart cannot hint at: a stock that is 90% institutionally held
 * behaves differently in a selloff from one that is 20% held, because the
 * marginal seller is a different kind of investor with different constraints.
 *
 * Rating changes are shown as *changes* rather than levels, because the level
 * is already in the consensus panel and the change is the news.
 */
export function OwnershipPanel({
  ownership,
  ratings,
  currency,
  loading,
  className,
}: {
  ownership: Ownership | null;
  ratings: RatingChange[];
  currency: Currency;
  loading: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Ownership" />
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  if (!ownership && ratings.length === 0) {
    return (
      <Panel flush className={className}>
        <PanelHeader title="Ownership" />
        <EmptyState
          icon={<IconUser />}
          title="Not published"
          description="No ownership breakdown is available for this listing from the sources in use."
        />
      </Panel>
    );
  }

  const institution = ownership?.institutionPercent ?? null;
  const insider = ownership?.insiderPercent ?? null;
  // Whatever is not held by insiders or institutions is, broadly, retail and
  // untracked float. Clamped because the two figures are reported separately
  // and occasionally overlap.
  const other =
    institution != null && insider != null
      ? Math.max(0, 100 - institution - insider)
      : null;

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Ownership"
        subtitle={
          ownership?.institutionCount
            ? `${ownership.institutionCount.toLocaleString()} institutional holders on file`
            : "Who holds the shares"
        }
      />

      {ownership && (institution != null || insider != null) && (
        <div className="p-4">
          <div className="flex h-2 gap-px overflow-hidden rounded-full bg-ink-800">
            {institution != null && (
              <motion.span
                className="bg-usa"
                initial={{ width: 0 }}
                animate={{ width: `${institution}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                title={`Institutions ${institution.toFixed(1)}%`}
              />
            )}
            {insider != null && (
              <motion.span
                className="bg-signal"
                initial={{ width: 0 }}
                animate={{ width: `${insider}%` }}
                transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                title={`Insiders ${insider.toFixed(1)}%`}
              />
            )}
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-x-4">
            <Stat label="Institutions" value={institution} tone="usa" />
            <Stat label="Insiders" value={insider} tone="signal" />
            <Stat label="Everyone else" value={other} tone="muted" />
          </dl>

          {institution != null && (
            <p className="mt-3.5 text-[11px] leading-relaxed text-ivory-40">
              {institution > 80
                ? "Very heavily institutionally owned. The marginal seller here is a fund with a mandate, which tends to make selloffs faster and more correlated."
                : institution < 30
                  ? "Lightly institutionally owned. Price is set more by retail flow, which is noisier but less prone to coordinated exits."
                  : "A fairly typical institutional share for a company of this size."}
            </p>
          )}
        </div>
      )}

      {ownership && ownership.topHolders.length > 0 && (
        <div className="border-t border-line">
          <p className="label-micro px-4 pb-2 pt-3.5 text-ivory-40">Largest holders</p>
          <ul className="divide-y divide-line/60">
            {ownership.topHolders.slice(0, 5).map((h, i) => (
              <motion.li
                key={h.name}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.28, delay: i * 0.04 }}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-ivory-80">{h.name}</span>
                <span className="flex shrink-0 items-center gap-4">
                  {h.percentHeld != null && (
                    <span className="num-mono text-[11px] text-ivory">
                      {h.percentHeld.toFixed(2)}%
                    </span>
                  )}
                  {h.value != null && (
                    <span className="num-mono hidden w-[68px] text-right text-[11px] text-ivory-40 sm:block">
                      {formatCompactMoney(h.value, currency)}
                    </span>
                  )}
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      {ratings.length > 0 && (
        <div className="border-t border-line">
          <p className="label-micro px-4 pb-2 pt-3.5 text-ivory-40">Recent rating changes</p>
          <ul className="divide-y divide-line/60">
            {ratings.slice(0, 6).map((r, i) => (
              <motion.li
                key={`${r.firm}-${r.at}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: i * 0.03 }}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-ivory-80">{r.firm}</span>
                  <span className="mt-0.5 block text-[10px] text-ivory-40">
                    {r.from ? `${r.from} → ${r.to}` : r.to}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge
                    tone={
                      r.action === "upgrade" ? "up" : r.action === "downgrade" ? "down" : "neutral"
                    }
                  >
                    {r.action}
                  </Badge>
                  <Tooltip content={r.at ? formatDate(r.at) : "Date not published"}>
                    <span className="num-mono w-[52px] cursor-help text-right text-[10px] text-ivory-40">
                      {r.at ? formatRelative(r.at) : "—"}
                    </span>
                  </Tooltip>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "usa" | "signal" | "muted";
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 rounded-[1px]",
            tone === "usa" ? "bg-usa" : tone === "signal" ? "bg-signal" : "bg-ink-700",
          )}
        />
        <span className="label-micro text-ivory-40">{label}</span>
      </dt>
      <dd className="num-mono mt-1.5 text-[14px] text-ivory">
        {value != null ? `${value.toFixed(1)}%` : "—"}
      </dd>
    </div>
  );
}
