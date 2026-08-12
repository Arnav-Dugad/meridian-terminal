"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { formatPrice, formatPercent } from "@/lib/format";
import type { PriceAlert } from "@/lib/store/types";
import { IconBell, IconClose } from "@/components/ui/icons";

/**
 * Evaluates price alerts against the live stream.
 *
 * Mounted once by the shell, so alerts fire from any page. The evaluation runs
 * against the same shared quote store everything else reads, which means an
 * alert on a symbol already on screen costs nothing at all — no extra
 * subscription, no extra request.
 *
 * Scope, stated plainly: this fires while a Meridian tab is open. Delivering a
 * trigger to a closed browser needs a server-side worker holding subscriptions
 * and a push service, which is a different piece of infrastructure from a
 * client bundle. The UI says so rather than implying otherwise.
 */
export function AlertWatcher() {
  const { alerts, markAlertTriggered } = usePersonal();

  const activeAlerts = useMemo(() => alerts.filter((a) => a.active), [alerts]);
  const slugs = useMemo(
    () => Array.from(new Set(activeAlerts.map((a) => a.slug))),
    [activeAlerts],
  );

  const { map } = useQuotes(slugs);
  const [fired, setFired] = useState<{ alert: PriceAlert; price: number }[]>([]);
  const alreadyFired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeAlerts.length === 0) return;

    for (const alert of activeAlerts) {
      if (alreadyFired.current.has(alert.id)) continue;
      const quote = map.get(alert.slug);
      if (!quote) continue;

      if (!isTriggered(alert, quote.price)) continue;

      alreadyFired.current.add(alert.id);
      markAlertTriggered(alert.id, Date.now());
      setFired((prev) => [...prev, { alert, price: quote.price }].slice(-3));
      notify(alert, quote.price);
    }
  }, [activeAlerts, map, markAlertTriggered]);

  const dismiss = (id: string) => setFired((prev) => prev.filter((f) => f.alert.id !== id));

  return (
    <div
      className="pointer-events-none fixed right-4 top-[68px] z-[70] flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {fired.map(({ alert, price }) => (
          <motion.div
            key={alert.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="pointer-events-auto overflow-hidden rounded-md border border-signal/35 bg-ink-850/97 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md"
          >
            <div className="flex items-start gap-3 p-3.5">
              <span className="mt-0.5 shrink-0 text-signal">
                <IconBell />
              </span>

              <div className="min-w-0 flex-1">
                <p className="label-micro text-signal">Alert triggered</p>
                <p className="mt-1.5 text-[13px] text-ivory">
                  <Link
                    href={`/stock/${encodeURIComponent(alert.slug)}`}
                    className="num-mono underline decoration-line-bright underline-offset-2 hover:decoration-signal"
                  >
                    {alert.symbol}
                  </Link>{" "}
                  <span className="text-ivory-60">{describe(alert)}</span>
                </p>
                <p className="num-mono mt-1.5 text-[12px] text-ivory-80">
                  Now {formatPrice(price, alert.currency)}
                </p>
              </div>

              <button
                onClick={() => dismiss(alert.id)}
                className="shrink-0 text-ivory-40 transition-colors hover:text-ivory"
                aria-label="Dismiss alert"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Self-dismiss timer, visible so it does not feel arbitrary. */}
            <motion.div
              className="h-[2px] bg-signal/50"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 12, ease: "linear" }}
              style={{ transformOrigin: "left" }}
              onAnimationComplete={() => dismiss(alert.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── Evaluation ───────────────────────────────────────────────────────────── */

export function isTriggered(alert: PriceAlert, price: number): boolean {
  switch (alert.kind) {
    case "above":
      return price >= alert.threshold;
    case "below":
      return price <= alert.threshold;
    case "pct-gain":
      return alert.basePrice > 0 && ((price - alert.basePrice) / alert.basePrice) * 100 >= alert.threshold;
    case "pct-loss":
      return alert.basePrice > 0 && ((price - alert.basePrice) / alert.basePrice) * 100 <= -alert.threshold;
    default:
      return false;
  }
}

export function describe(alert: PriceAlert): string {
  switch (alert.kind) {
    case "above":
      return `rose above ${formatPrice(alert.threshold, alert.currency)}`;
    case "below":
      return `fell below ${formatPrice(alert.threshold, alert.currency)}`;
    case "pct-gain":
      return `gained ${formatPercent(alert.threshold, { signed: false })} from ${formatPrice(alert.basePrice, alert.currency)}`;
    case "pct-loss":
      return `lost ${formatPercent(alert.threshold, { signed: false })} from ${formatPrice(alert.basePrice, alert.currency)}`;
    default:
      return "triggered";
  }
}

function notify(alert: PriceAlert, price: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  // Only ever fire on a permission the user has already granted; asking at the
  // moment of a trigger is the worst possible time to prompt.
  if (Notification.permission !== "granted") return;
  try {
    new Notification(`${alert.symbol} ${describe(alert)}`, {
      body: `Now trading at ${formatPrice(price, alert.currency)}`,
      tag: alert.id,
      icon: "/icon.svg",
    });
  } catch {
    /* some browsers reject constructed notifications outside a worker */
  }
}

/** Requests notification permission. Called from the alerts page, on a click. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
