"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AlertComposer } from "@/components/market/AlertComposer";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  Segmented,
} from "@/components/ui/primitives";
import { IconBell, IconPlus, IconSearch, IconTrash } from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { useCommandPalette } from "@/components/shell/CommandPalette";
import {
  describe,
  notificationPermission,
  requestNotificationPermission,
} from "@/components/shell/AlertWatcher";
import { findBySlug } from "@/lib/market/universe";
import { formatPercent, formatPrice, formatRelative } from "@/lib/format";
import type { PriceAlert } from "@/lib/store/types";
import { cn } from "@/lib/utils";

type Tab = "active" | "triggered";

export function AlertsView() {
  const { alerts, removeAlert, updateAlert, mode, ready } = usePersonal();
  const { setOpen } = useCommandPalette();
  const [tab, setTab] = useState<Tab>("active");
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => setPermission(notificationPermission()), []);

  const slugs = useMemo(() => Array.from(new Set(alerts.map((a) => a.slug))), [alerts]);
  const { map, source } = useQuotes(slugs);

  const active = alerts.filter((a) => a.active);
  const triggered = alerts.filter((a) => !a.active);
  const visible = tab === "active" ? active : triggered;

  const composerPrice = composerFor ? (map.get(composerFor)?.price ?? 0) : 0;

  if (ready && alerts.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Alerts"
          title="Price triggers"
          description="Set a level or a percentage move, and Meridian watches the stream for you."
          actions={
            <Button variant="primary" size="md" icon={<IconSearch />} onClick={() => setOpen(true)}>
              Find a symbol
            </Button>
          }
        />
        <PageBody>
          <Panel flush>
            <EmptyState
              icon={<IconBell />}
              title="No alerts set"
              description="Open any instrument and press Alert to set a trigger — an absolute level, or a percentage move from wherever it is trading right now."
              action={
                <Button variant="primary" size="md" onClick={() => setOpen(true)}>
                  Search instruments
                </Button>
              }
            />
          </Panel>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="Price triggers"
        description="Evaluated continuously against the live stream while a Meridian tab is open."
        meta={
          <>
            <DataSourceNotice source={source} />
            <Badge tone={active.length > 0 ? "signal" : "neutral"}>{active.length} armed</Badge>
            {triggered.length > 0 && <Badge tone="neutral">{triggered.length} fired</Badge>}
            <Badge tone={mode === "cloud" ? "up" : "signal"}>
              {mode === "cloud" ? "Cloud sync" : "This device"}
            </Badge>
          </>
        }
        actions={
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              layoutIdSuffix="alerts-tab"
              options={[
                { value: "active", label: `Armed (${active.length})` },
                { value: "triggered", label: `Fired (${triggered.length})` },
              ]}
            />
            <Button variant="primary" size="md" icon={<IconPlus />} onClick={() => setOpen(true)}>
              New alert
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        {permission === "default" && (
          <Panel className="border-signal/30 bg-signal/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="label-micro text-signal">Browser notifications are off</p>
                <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ivory-60">
                  Without permission, triggers appear only as a card inside the terminal.
                  Grant it and they surface as system notifications even when Meridian is in
                  a background tab.
                </p>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={async () => setPermission(await requestNotificationPermission())}
              >
                Enable notifications
              </Button>
            </div>
          </Panel>
        )}

        <Panel flush>
          <PanelHeader
            title={tab === "active" ? "Armed" : "Fired"}
            subtitle={
              tab === "active"
                ? "Distance to trigger updates with the tape"
                : "Re-arm to watch the same level again"
            }
          />

          {visible.length === 0 ? (
            <EmptyState
              title={tab === "active" ? "Nothing armed" : "Nothing has fired yet"}
              description={
                tab === "active"
                  ? "Every alert you set has already triggered. Re-arm one from the Fired tab, or create a new one."
                  : "Triggered alerts land here with the time they fired."
              }
            />
          ) : (
            <ul className="divide-y divide-line/60">
              <AnimatePresence initial={false}>
                {visible.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    price={map.get(alert.slug)?.price}
                    onRemove={() => removeAlert(alert.id)}
                    onRearm={() => {
                      const price = map.get(alert.slug)?.price ?? alert.basePrice;
                      updateAlert(alert.id, { active: true, basePrice: price });
                    }}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Panel>

        <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
          Alerts are evaluated in the browser against the shared quote stream, so they fire
          while a Meridian tab is open. Delivering a trigger to a closed browser needs a
          server-side worker and a push service — deliberately out of scope here rather
          than half-implemented and unreliable.
        </p>
      </PageBody>

      {composerFor && (
        <AlertComposer
          slug={composerFor}
          open
          onClose={() => setComposerFor(null)}
          currentPrice={composerPrice}
        />
      )}
    </>
  );
}

function AlertRow({
  alert,
  price,
  onRemove,
  onRearm,
}: {
  alert: PriceAlert;
  price: number | undefined;
  onRemove: () => void;
  onRearm: () => void;
}) {
  const instrument = findBySlug(alert.slug);

  const target =
    alert.kind === "above" || alert.kind === "below"
      ? alert.threshold
      : alert.kind === "pct-gain"
        ? alert.basePrice * (1 + alert.threshold / 100)
        : alert.basePrice * (1 - alert.threshold / 100);

  const distance = price != null && price > 0 ? ((target - price) / price) * 100 : null;

  // How close the price has crept toward the trigger, as a bar.
  const proximity =
    distance == null ? 0 : Math.max(0, Math.min(1, 1 - Math.min(Math.abs(distance), 20) / 20));

  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className="group px-4 py-3.5 transition-colors hover:bg-ink-850"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={`/stock/${encodeURIComponent(alert.slug)}`}
              className="num-mono text-[13px] text-ivory underline decoration-line-bright underline-offset-4 transition-colors hover:decoration-signal"
            >
              {alert.symbol}
            </Link>
            {instrument && (
              <Badge tone={instrument.region === "IN" ? "india" : "usa"}>{instrument.exchange}</Badge>
            )}
            {!alert.active && alert.triggeredAt && (
              <Badge tone="signal">Fired {formatRelative(alert.triggeredAt)}</Badge>
            )}
          </div>

          <p className="mt-1.5 text-[12px] text-ivory-60">
            Triggers when it {describe(alert).replace(/^(rose|fell|gained|lost)/, (m) =>
              ({ rose: "rises", fell: "falls", gained: "gains", lost: "loses" })[m] ?? m,
            )}
          </p>

          {alert.note && (
            <p className="mt-1.5 max-w-[60ch] text-[11px] italic text-ivory-40">“{alert.note}”</p>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="label-micro text-ivory-40">Now</p>
            <p className="num-mono mt-1 text-[13px] text-ivory">
              {price != null ? formatPrice(price, alert.currency) : "—"}
            </p>
          </div>

          <div className="text-right">
            <p className="label-micro text-ivory-40">Target</p>
            <p className="num-mono mt-1 text-[13px] text-signal">
              {formatPrice(target, alert.currency)}
            </p>
          </div>

          <div className="hidden w-[86px] text-right sm:block">
            <p className="label-micro text-ivory-40">Distance</p>
            <p
              className={cn(
                "num-mono mt-1 text-[13px]",
                distance == null
                  ? "text-ivory-40"
                  : Math.abs(distance) < 1
                    ? "text-signal"
                    : "text-ivory-60",
              )}
            >
              {distance != null ? formatPercent(distance) : "—"}
            </p>
          </div>

          <div className="flex items-center gap-1">
            {!alert.active && (
              <Button variant="outline" size="sm" onClick={onRearm}>
                Re-arm
              </Button>
            )}
            <button
              onClick={onRemove}
              aria-label={`Delete alert for ${alert.symbol}`}
              className="rounded-sm p-1.5 text-ivory-25 opacity-0 transition-all hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {alert.active && distance != null && (
        <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-ink-800">
          <motion.div
            className={cn("h-full rounded-full", proximity > 0.85 ? "bg-signal" : "bg-ink-600")}
            initial={{ width: 0 }}
            animate={{ width: `${proximity * 100}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      )}
    </motion.li>
  );
}
