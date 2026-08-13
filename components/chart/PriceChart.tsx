"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  ChartEngine,
  type ChartEvent,
  type ChartHover,
  type ChartStyle,
  type OverlaySeries,
} from "@/components/chart/engine";
import type { Candle } from "@/lib/twelvedata/types";
import type { Currency } from "@/lib/format";
import { formatCompact, formatPrice, formatPercent } from "@/lib/format";
import { bollinger, ema, sma, vwap } from "@/lib/analytics/indicators";
import { cn } from "@/lib/utils";

export interface IndicatorSpec {
  id: string;
  label: string;
  color: string;
}

/** Overlays the chart offers, in the order they appear in the picker. */
export const INDICATOR_CATALOGUE: IndicatorSpec[] = [
  { id: "ema20", label: "EMA 20", color: "#f0a63c" },
  { id: "ema50", label: "EMA 50", color: "#7ba7f0" },
  { id: "ema200", label: "EMA 200", color: "#d67ef0" },
  { id: "sma50", label: "SMA 50", color: "#4fd1c5" },
  { id: "bb", label: "Bollinger", color: "#8f9bb3" },
  { id: "vwap", label: "VWAP", color: "#c9a227" },
];

interface PriceChartProps {
  candles: Candle[];
  currency: Currency;
  style?: ChartStyle;
  indicators?: string[];
  /** Drawn as a dashed reference line — the previous close, usually. */
  baseline?: number | null;
  baselineLabel?: string;
  intraday?: boolean;
  showVolume?: boolean;
  loading?: boolean;
  className?: string;
  height?: number;
  /** Corporate actions marked on the time axis. */
  events?: ChartEvent[];
  /** Shown in place of the chart when no history could be retrieved. */
  unavailableReason?: string | null;
}

export function PriceChart({
  candles,
  currency,
  style = "area",
  indicators = [],
  baseline = null,
  baselineLabel = "Prev close",
  intraday = false,
  showVolume = true,
  loading = false,
  className,
  height = 420,
  events,
  unavailableReason = null,
}: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const shouldReduceMotion = useReducedMotion();

  const closes = useMemo(() => candles.map((c) => c.c), [candles]);

  const overlays = useMemo<OverlaySeries[]>(() => {
    const out: OverlaySeries[] = [];
    if (candles.length < 3) return out;

    for (const id of indicators) {
      const spec = INDICATOR_CATALOGUE.find((s) => s.id === id);
      if (!spec) continue;

      switch (id) {
        case "ema20":
          out.push({ id, values: ema(closes, 20), color: spec.color, width: 1.25 });
          break;
        case "ema50":
          out.push({ id, values: ema(closes, 50), color: spec.color, width: 1.25 });
          break;
        case "ema200":
          out.push({ id, values: ema(closes, 200), color: spec.color, width: 1.25 });
          break;
        case "sma50":
          out.push({ id, values: sma(closes, 50), color: spec.color, width: 1.1, dashed: true });
          break;
        case "bb": {
          const b = bollinger(closes, 20, 2);
          out.push({ id: "bb-upper", values: b.upper, color: spec.color, width: 1, fillTo: "bb-lower", fillOpacity: 0.05 });
          out.push({ id: "bb-lower", values: b.lower, color: spec.color, width: 1 });
          out.push({ id: "bb-mid", values: b.middle, color: spec.color, width: 0.9, dashed: true });
          break;
        }
        case "vwap":
          out.push({ id, values: vwap(candles), color: spec.color, width: 1.2, dashed: true });
          break;
      }
    }
    return out;
  }, [candles, closes, indicators]);

  const levels = useMemo(
    () =>
      baseline != null
        ? [{ price: baseline, label: baselineLabel, color: "#6a6862", dashed: true }]
        : [],
    [baseline, baselineLabel],
  );

  // Engine lifetime is tied to the canvas node, not to props.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ChartEngine(canvas, {
      style,
      showVolume,
      showGrid: true,
      overlays,
      levels,
      intraday,
      onHover: setHover,
      reducedMotion: shouldReduceMotion ?? false,
      formatPrice: (v) => compactAxisPrice(v, currency),
      formatTime: (t, kind) => formatAxisTime(t, kind),
    });
    engineRef.current = engine;

    const measure = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) setSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Options are pushed separately so a style toggle never rebuilds the engine
  // — that would discard the morph and make the switch flash.
  useEffect(() => {
    engineRef.current?.setOptions({
      style,
      showVolume,
      overlays,
      levels,
      intraday,
      events,
      reducedMotion: shouldReduceMotion ?? false,
      formatPrice: (v) => compactAxisPrice(v, currency),
    });
  }, [style, showVolume, overlays, levels, intraday, events, shouldReduceMotion, currency]);

  useEffect(() => {
    if (candles.length === 0) return;
    engineRef.current?.setData(candles);
  }, [candles]);

  const hovered = hover?.candle;
  const previous = hover ? candles[hover.index - 1] : undefined;
  const barChange = hovered && previous ? ((hovered.c - previous.c) / previous.c) * 100 : null;

  // Flip the tooltip to the other side of the crosshair near the right edge.
  const tooltipLeft = hover ? (hover.x > size.w - 210 ? hover.x - 198 : hover.x + 14) : 0;

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-hidden />

      {/* Accessible equivalent of the canvas. */}
      <span className="sr-only">
        {candles.length > 0
          ? `Price chart with ${candles.length} bars. Latest close ${formatPrice(
              candles[candles.length - 1]?.c ?? 0,
              currency,
            )}.`
          : "Price chart, no data available."}
      </span>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute z-20 w-[184px] rounded-md border border-line-strong bg-ink-850/95 p-2.5 backdrop-blur-sm"
            style={{ left: tooltipLeft, top: 12 }}
          >
            <div className="label-micro mb-2 text-ivory-60">
              {formatTooltipTime(hovered.t, intraday)}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <Row label="Open" value={formatPrice(hovered.o, currency)} />
              <Row label="High" value={formatPrice(hovered.h, currency)} />
              <Row label="Low" value={formatPrice(hovered.l, currency)} />
              <Row
                label="Close"
                value={formatPrice(hovered.c, currency)}
                tone={hovered.c >= hovered.o ? "up" : "down"}
              />
            </dl>
            {(hovered.v > 0 || barChange != null) && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[11px]">
                {hovered.v > 0 && (
                  <span className="text-ivory-60">
                    Vol <span className="num-mono text-ivory-80">{formatCompact(hovered.v, currency)}</span>
                  </span>
                )}
                {barChange != null && (
                  <span className={cn("num-mono", barChange >= 0 ? "text-up" : "text-down")}>
                    {formatPercent(barChange)}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/45 backdrop-blur-[1px]">
          <div className="label-micro flex items-center gap-2 text-ivory-60">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
            </span>
            Loading series
          </div>
        </div>
      )}

      {/*
        An explicit, explained gap — never a placeholder curve. A fabricated
        chart is indistinguishable from a real one at a glance, which is the
        one failure mode worse than showing nothing.
      */}
      {!loading && candles.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="label-micro text-ivory-60">Price history unavailable</p>
          <p className="max-w-[46ch] text-[11px] leading-relaxed text-ivory-40">
            {unavailableReason ??
              "No data source could return history for this instrument right now. This usually clears within a minute."}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <>
      <dt className="text-ivory-60">{label}</dt>
      <dd
        className={cn(
          "num-mono text-right",
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </dd>
    </>
  );
}

/** Axis labels have ~54px; drop the currency symbol and abbreviate hard. */
function compactAxisPrice(v: number, currency: Currency): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(1)}${currency === "INR" ? "Cr" : "0M"}`;
  if (abs >= 1e5) return `${(v / 1e3).toFixed(0)}K`;
  if (abs >= 1000) return v.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 });
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function formatAxisTime(t: number, kind: "intraday" | "daily"): string {
  const d = new Date(t);
  if (kind === "intraday") {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(d);
}

function formatTooltipTime(t: number, intraday: boolean): string {
  const d = new Date(t);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: intraday ? undefined : "numeric",
    hour: intraday ? "2-digit" : undefined,
    minute: intraday ? "2-digit" : undefined,
    hour12: false,
  }).format(d);
}
