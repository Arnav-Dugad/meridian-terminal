"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePersonal } from "@/lib/store/personal";
import type { FlowAlert, FlowAlertKind } from "@/lib/store/types";
import { Badge, Button, EmptyState, Input, Panel, PanelHeader, Segmented } from "@/components/ui/primitives";
import { IconBell, IconPlus, IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Alerts on institutional flow.
 *
 * "Tell me when foreign institutions sell more than 5,000 crore in a session"
 * is a question no consumer terminal will answer, and it is the single most
 * watched number on an Indian desk. Because the exchange publishes once per
 * session, these are evaluated against the daily figure rather than a live
 * price — and they re-arm the next day rather than being spent permanently,
 * since the question is recurring by nature.
 */

interface FlowDay {
  date: string;
  label: string;
  fii: { buy: number; sell: number; net: number };
  dii: { buy: number; sell: number; net: number };
}

const KIND_LABEL: Record<FlowAlertKind, string> = {
  "fii-buy-above": "Foreign net buying exceeds",
  "fii-sell-above": "Foreign net selling exceeds",
  "dii-buy-above": "Domestic net buying exceeds",
  "dii-sell-above": "Domestic net selling exceeds",
  "combined-buy-above": "Combined net buying exceeds",
  "combined-sell-above": "Combined net selling exceeds",
  "deal-buy-above": "Any single fund buys more than",
  "deal-sell-above": "Any single fund sells more than",
};

/** The two that watch individual trades rather than the daily aggregate. */
const DEAL_KINDS: FlowAlertKind[] = ["deal-buy-above", "deal-sell-above"];

/**
 * Evaluate one alert against a session.
 *
 * Net figures are signed, so "selling above X" is a net *below* −X. Comparing
 * the absolute value instead would fire a sell alert on a buying day.
 */
export interface DealMatch {
  symbol: string;
  client: string;
  side: "BUY" | "SELL" | null;
  /** Rupees. */
  value: number | null;
}

/**
 * Deal alerts watch individual disclosed trades rather than the daily
 * aggregate, so they take the session's deal list instead of the flow figures.
 * Thresholds are in crore to match the flow alerts; deal values arrive in
 * rupees, hence the conversion.
 */
export function evaluateDealAlert(alert: FlowAlert, deals: DealMatch[]): DealMatch | null {
  if (!DEAL_KINDS.includes(alert.kind)) return null;
  const wantSide = alert.kind === "deal-buy-above" ? "BUY" : "SELL";
  const thresholdRupees = alert.threshold * 1e7;

  const matches = deals.filter(
    (d) => d.side === wantSide && (d.value ?? 0) >= thresholdRupees,
  );
  if (matches.length === 0) return null;

  // Report the largest, which is the one worth naming in the alert.
  return matches.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a));
}

export function evaluateFlowAlert(alert: FlowAlert, day: FlowDay): boolean {
  const combined = day.fii.net + day.dii.net;

  switch (alert.kind) {
    case "fii-buy-above":
      return day.fii.net >= alert.threshold;
    case "fii-sell-above":
      return day.fii.net <= -alert.threshold;
    case "dii-buy-above":
      return day.dii.net >= alert.threshold;
    case "dii-sell-above":
      return day.dii.net <= -alert.threshold;
    case "combined-buy-above":
      return combined >= alert.threshold;
    case "combined-sell-above":
      return combined <= -alert.threshold;
    default:
      return false;
  }
}

function currentValue(alert: FlowAlert, day: FlowDay): number {
  const combined = day.fii.net + day.dii.net;
  if (alert.kind.startsWith("fii")) return day.fii.net;
  if (alert.kind.startsWith("dii")) return day.dii.net;
  return combined;
}

export function FlowAlertsPanel({
  latest,
  deals = [],
  dealDate,
}: {
  latest: FlowDay | null;
  /** The session's disclosed trades, for deal-threshold alerts. */
  deals?: DealMatch[];
  dealDate?: string;
}) {
  const { flowAlerts, addFlowAlert, removeFlowAlert, markFlowAlertTriggered, rearmFlowAlert } =
    usePersonal();

  const [kind, setKind] = useState<FlowAlertKind>("fii-sell-above");
  const [threshold, setThreshold] = useState("5000");
  const [adding, setAdding] = useState(false);

  /**
   * Fire any armed alert the latest session satisfies.
   *
   * Guarded on `triggeredForDate` so a threshold met on Tuesday does not fire
   * again every time the page is opened on Tuesday, but does re-arm for
   * Wednesday's figures.
   */
  useEffect(() => {
    for (const alert of flowAlerts) {
      if (!alert.active) continue;

      if (DEAL_KINDS.includes(alert.kind)) {
        if (!dealDate || alert.triggeredForDate === dealDate) continue;
        if (evaluateDealAlert(alert, deals)) markFlowAlertTriggered(alert.id, dealDate);
        continue;
      }

      if (!latest || alert.triggeredForDate === latest.date) continue;
      if (evaluateFlowAlert(alert, latest)) markFlowAlertTriggered(alert.id, latest.date);
    }
  }, [latest, deals, dealDate, flowAlerts, markFlowAlertTriggered]);

  const numeric = Number(threshold);
  const valid = Number.isFinite(numeric) && numeric > 0;

  const triggeredToday = useMemo(
    () => flowAlerts.filter((a) => latest && a.triggeredForDate === latest.date),
    [flowAlerts, latest],
  );

  return (
    <Panel flush>
      <PanelHeader
        title="Flow alerts"
        subtitle="Watch the institutional tape for a threshold you care about"
        action={
          <div className="flex items-center gap-2">
            {triggeredToday.length > 0 && (
              <Badge tone="signal">{triggeredToday.length} triggered</Badge>
            )}
            <Button
              variant={adding ? "ghost" : "secondary"}
              size="sm"
              icon={adding ? undefined : <IconPlus />}
              onClick={() => setAdding((a) => !a)}
            >
              {adding ? "Cancel" : "New alert"}
            </Button>
          </div>
        }
      />

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-b border-line"
          >
            <div className="space-y-4 p-4">
              <div>
                <p className="label-micro mb-2 text-ivory-40">Condition</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {(Object.keys(KIND_LABEL) as FlowAlertKind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      className={cn(
                        "rounded-sm border px-3 py-2 text-left text-[12px] transition-colors duration-150",
                        kind === k
                          ? "border-signal/50 bg-signal/[0.08] text-ivory"
                          : "border-line text-ivory-60 hover:border-line-bright hover:text-ivory",
                      )}
                    >
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[180px]">
                  <Input
                    label="Threshold"
                    type="number"
                    min="1"
                    step="100"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    trailing={<span className="text-[12px]">Cr</span>}
                  />
                </div>

                {latest && valid && (
                  <p className="pb-2.5 text-[11px] leading-relaxed text-ivory-40">
                    Latest session was{" "}
                    <span className="num-mono text-ivory-60">
                      {formatCrore(currentValue({ kind, threshold: numeric } as FlowAlert, latest))}
                    </span>
                    {" — "}
                    {evaluateFlowAlert(
                      { kind, threshold: numeric, id: "", active: true, createdAt: 0 },
                      latest,
                    )
                      ? "this would already have fired."
                      : "below your threshold."}
                  </p>
                )}

                <Button
                  variant="primary"
                  size="md"
                  disabled={!valid}
                  onClick={() => {
                    addFlowAlert(kind, numeric);
                    setAdding(false);
                  }}
                >
                  Create alert
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {flowAlerts.length === 0 ? (
        <EmptyState
          icon={<IconBell />}
          title="No flow alerts"
          description="Set a threshold and Meridian will flag the session it is crossed. A common one: foreign net selling above ₹5,000 crore, which has historically marked short-term capitulation."
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {flowAlerts.map((alert) => {
            const fired = latest != null && alert.triggeredForDate === latest.date;
            const value = latest ? currentValue(alert, latest) : null;

            return (
              <motion.li
                key={alert.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn(
                  "group flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors",
                  fired ? "bg-signal/[0.06]" : "hover:bg-ink-850",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[12px] text-ivory">
                    {KIND_LABEL[alert.kind]}{" "}
                    <span className="num-mono text-signal">₹{alert.threshold.toLocaleString("en-IN")} Cr</span>
                    {fired && <Badge tone="signal">Triggered</Badge>}
                  </p>
                  {alert.triggeredAt && !fired && (
                    <p className="mt-1 text-[11px] text-ivory-40">
                      Last fired for the {alert.triggeredForDate} session
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {value != null && !DEAL_KINDS.includes(alert.kind) && (
                    <span className="text-right">
                      <span className="label-micro block text-ivory-40">Latest</span>
                      <span
                        className={cn(
                          "num-mono mt-0.5 block text-[12px]",
                          value >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatCrore(value)}
                      </span>
                    </span>
                  )}

                  {alert.triggeredAt && !fired && (
                    <Button variant="outline" size="sm" onClick={() => rearmFlowAlert(alert.id)}>
                      Re-arm
                    </Button>
                  )}

                  <button
                    onClick={() => removeFlowAlert(alert.id)}
                    aria-label="Delete alert"
                    className="rounded-sm p-1.5 text-ivory-25 opacity-0 transition-all hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Evaluated against the exchange's daily figures, which publish after the close. An
        alert that fires today re-arms for tomorrow's session automatically.
      </p>
    </Panel>
  );
}

function formatCrore(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}
