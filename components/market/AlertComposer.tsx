"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePersonal } from "@/lib/store/personal";
import { findBySlug } from "@/lib/market/universe";
import { formatPercent, formatPrice } from "@/lib/format";
import type { AlertKind } from "@/lib/store/types";
import { Button, Input, Segmented } from "@/components/ui/primitives";
import { IconClose } from "@/components/ui/icons";
import {
  notificationPermission,
  requestNotificationPermission,
} from "@/components/shell/AlertWatcher";
import { cn } from "@/lib/utils";

/**
 * Alert composer.
 *
 * Opens pre-filled with a threshold a small distance from the current price,
 * because an alert set exactly at spot fires immediately and teaches the user
 * the feature is broken. The live distance-to-trigger readout updates as the
 * number is typed, so the consequence of the input is visible before it is
 * committed.
 */

const KINDS: { value: AlertKind; label: string; help: string }[] = [
  { value: "above", label: "Rises above", help: "Fires the first time the price prints at or above your level." },
  { value: "below", label: "Falls below", help: "Fires the first time the price prints at or below your level." },
  { value: "pct-gain", label: "Gains %", help: "Fires when the price is up by this much from where it is now." },
  { value: "pct-loss", label: "Loses %", help: "Fires when the price is down by this much from where it is now." },
];

export function AlertComposer({
  slug,
  open,
  onClose,
  currentPrice,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  currentPrice: number;
}) {
  const { addAlert } = usePersonal();
  const instrument = findBySlug(slug);

  const [kind, setKind] = useState<AlertKind>("above");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [permission, setPermission] = useState<string>("default");

  const isPercent = kind === "pct-gain" || kind === "pct-loss";

  // Seed a sensible default: 2% away for levels, 5 points for percentages.
  useEffect(() => {
    if (!open) return;
    setPermission(notificationPermission());
    setValue(
      isPercent
        ? "5"
        : (kind === "above" ? currentPrice * 1.02 : currentPrice * 0.98).toFixed(
            currentPrice >= 100 ? 0 : 2,
          ),
    );
  }, [open, kind, currentPrice, isPercent]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const numeric = Number(value);
  const valid = Number.isFinite(numeric) && numeric > 0;

  const preview = useMemo(() => {
    if (!valid || !instrument) return null;
    if (isPercent) {
      const target =
        kind === "pct-gain" ? currentPrice * (1 + numeric / 100) : currentPrice * (1 - numeric / 100);
      return {
        target,
        distance: ((target - currentPrice) / currentPrice) * 100,
      };
    }
    return { target: numeric, distance: ((numeric - currentPrice) / currentPrice) * 100 };
  }, [valid, numeric, kind, currentPrice, isPercent, instrument]);

  const fireImmediately =
    preview != null &&
    ((kind === "above" && currentPrice >= preview.target) ||
      (kind === "below" && currentPrice <= preview.target));

  if (!instrument) return null;

  const submit = () => {
    if (!valid) return;
    addAlert({
      slug,
      kind,
      threshold: numeric,
      basePrice: currentPrice,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setNote("");
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75]" role="dialog" aria-modal aria-label="Create price alert">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 bg-ink-1000/70 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-1/2 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)]">
              <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <p className="label-micro text-signal">New alert</p>
                  <h2 className="mt-2 text-[15px] text-ivory">
                    <span className="num-mono">{instrument.symbol}</span>{" "}
                    <span className="text-ivory-40">· {instrument.name}</span>
                  </h2>
                  <p className="num-mono mt-1.5 text-[12px] text-ivory-60">
                    Currently {formatPrice(currentPrice, instrument.currency)}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="shrink-0 rounded-sm p-1.5 text-ivory-40 transition-colors hover:bg-ink-800 hover:text-ivory"
                  aria-label="Close"
                >
                  <IconClose />
                </button>
              </header>

              <div className="space-y-4 p-5">
                <div>
                  <p className="label-micro mb-2 text-ivory-60">Condition</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {KINDS.map((k) => (
                      <button
                        key={k.value}
                        onClick={() => setKind(k.value)}
                        className={cn(
                          "rounded-sm border px-3 py-2.5 text-left text-[12px] transition-colors duration-150",
                          kind === k.value
                            ? "border-signal/50 bg-signal/[0.08] text-ivory"
                            : "border-line text-ivory-60 hover:border-line-bright hover:text-ivory",
                        )}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ivory-40">
                    {KINDS.find((k) => k.value === kind)?.help}
                  </p>
                </div>

                <Input
                  label={isPercent ? "Percentage" : `Price (${instrument.currency})`}
                  type="number"
                  inputMode="decimal"
                  step={isPercent ? "0.5" : "0.01"}
                  min="0"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  trailing={<span className="text-[12px]">{isPercent ? "%" : instrument.currency}</span>}
                />

                {preview && (
                  <div
                    className={cn(
                      "rounded-sm border px-3.5 py-3",
                      fireImmediately
                        ? "border-signal/35 bg-signal/[0.06]"
                        : "border-line bg-ink-850",
                    )}
                  >
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-ivory-60">Triggers at</span>
                      <span className="num-mono text-[13px] text-ivory">
                        {formatPrice(preview.target, instrument.currency)}
                      </span>
                    </p>
                    <p className="mt-2 flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-ivory-60">Distance from here</span>
                      <span
                        className={cn(
                          "num-mono text-[12px]",
                          preview.distance > 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatPercent(preview.distance)}
                      </span>
                    </p>
                    {fireImmediately && (
                      <p className="mt-2.5 border-t border-signal/20 pt-2.5 text-[11px] leading-relaxed text-signal">
                        This condition is already met — the alert will fire as soon as it is
                        created.
                      </p>
                    )}
                  </div>
                )}

                <Input
                  label="Note (optional)"
                  placeholder="Why does this level matter?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={120}
                />

                {permission === "default" && (
                  <button
                    onClick={async () => setPermission(await requestNotificationPermission())}
                    className="w-full rounded-sm border border-line px-3 py-2.5 text-left text-[11px] leading-relaxed text-ivory-60 transition-colors hover:border-line-bright hover:text-ivory-80"
                  >
                    <span className="text-ivory">Enable browser notifications</span> — otherwise
                    triggers appear only inside this tab.
                  </button>
                )}
                {permission === "denied" && (
                  <p className="text-[11px] leading-relaxed text-ivory-40">
                    Notifications are blocked for this site, so alerts will surface inside the
                    terminal only.
                  </p>
                )}
              </div>

              <footer className="flex items-center justify-between gap-3 border-t border-line bg-ink-950/50 px-5 py-3.5">
                <p className="max-w-[24ch] text-[10px] leading-snug text-ivory-40">
                  Evaluated while a Meridian tab is open.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="md" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="md" onClick={submit} disabled={!valid}>
                    Create alert
                  </Button>
                </div>
              </footer>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
