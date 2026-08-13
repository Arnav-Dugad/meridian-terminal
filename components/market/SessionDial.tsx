"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import {
  EXCHANGES,
  formatCountdown,
  REGION_ACCENT,
  sessionState,
  type ExchangeCode,
} from "@/lib/market/exchanges";
import { convertMinutes, formatOffset, localTimezone, minutesInZone } from "@/lib/market/timezone";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/primitives";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";

/**
 * A twenty-four hour dial showing both trading sessions against the viewer's
 * own clock.
 *
 * This is the product's central claim made legible in one glance: the NSE
 * session and the US session sit on the same ring, they do not overlap, and
 * the gap between them is the window the terminal exists to cover. Plotting
 * them in local time — rather than in IST and ET side by side — is what makes
 * it personal; a reader in Bengaluru and one in New Jersey see the same
 * geometry rotated, and both immediately know when their day starts.
 */

const RADIUS = 78;
const CENTRE = 96;
const TRACK_WIDTH = 7;

interface DialSession {
  code: ExchangeCode;
  label: string;
  color: string;
  startLocal: number;
  endLocal: number;
  live: boolean;
}

export function SessionDial({
  className,
  exchanges = ["NSE", "NYSE"],
  compact = false,
}: {
  className?: string;
  exchanges?: ExchangeCode[];
  compact?: boolean;
}) {
  // Rendering clock-dependent geometry on the server guarantees a hydration
  // mismatch, so the dial mounts empty and fills in on the client.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const tz = useMemo(() => localTimezone(), []);

  useThemeVersion();
  const palette = chartPalette();

  const sessions = useMemo<DialSession[]>(() => {
    if (now == null) return [];
    return exchanges.map((code) => {
      const ex = EXCHANGES[code];
      const state = sessionState(code, new Date(now));
      return {
        code,
        label: ex.region === "IN" ? "India" : "United States",
        color: ex.region === "IN" ? "#f0a63c" : "#7ba7f0",
        startLocal: convertMinutes(ex.open, ex.timezone, tz, now),
        endLocal: convertMinutes(ex.close, ex.timezone, tz, now),
        live: state.isLive,
      };
    });
  }, [exchanges, tz, now]);

  const nowMinutes = now == null ? 0 : minutesInZone(tz, now);
  const handAngle = (nowMinutes / 1440) * 360;

  const openNow = sessions.filter((s) => s.live);

  return (
    /*
     * A container query, not a viewport one. This component appears in a 340px
     * sidebar, a 440px auth panel and a full-width section, and only the
     * container knows which. Below 22rem it stacks; above it, the dial sits
     * beside the list.
     */
    <div
      className={cn(
        "@container flex flex-col items-center gap-5 @[22rem]:flex-row @[22rem]:items-center @[22rem]:gap-6",
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: CENTRE * 2, height: CENTRE * 2 }}>
        <svg
          width={CENTRE * 2}
          height={CENTRE * 2}
          viewBox={`0 0 ${CENTRE * 2} ${CENTRE * 2}`}
          className="-rotate-90"
          role="img"
          aria-label="Twenty-four hour trading session dial"
        >
          {/* Track */}
          {/*
            Strokes take a colour string, so the dial paints with the resolved
            foreground token at varying opacity rather than a fixed ivory —
            which would be invisible on a light background.
          */}
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            fill="none"
            stroke={palette.text}
            strokeOpacity={0.09}
            strokeWidth={TRACK_WIDTH}
          />

          {/* Hour ticks — heavier every six hours. */}
          {Array.from({ length: 24 }, (_, h) => {
            const angle = (h / 24) * 360;
            const major = h % 6 === 0;
            const inner = RADIUS - TRACK_WIDTH / 2 - (major ? 7 : 3.5);
            const outer = RADIUS - TRACK_WIDTH / 2 - 1;
            const a = polar(CENTRE, CENTRE, inner, angle);
            const b = polar(CENTRE, CENTRE, outer, angle);
            return (
              <line
                key={h}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={palette.text}
                strokeOpacity={major ? 0.42 : 0.16}
                strokeWidth={major ? 1.2 : 1}
              />
            );
          })}

          {/* Session arcs. */}
          {sessions.map((s, i) => (
            <motion.path
              key={s.code}
              d={arcPath(CENTRE, CENTRE, RADIUS, (s.startLocal / 1440) * 360, (s.endLocal / 1440) * 360)}
              fill="none"
              stroke={s.color}
              strokeWidth={TRACK_WIDTH}
              strokeLinecap="round"
              strokeOpacity={s.live ? 1 : 0.42}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.1, delay: 0.15 + i * 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{ filter: s.live ? `drop-shadow(0 0 7px ${s.color}55)` : undefined }}
            />
          ))}

          {/* Now hand. */}
          {now != null && (
            <>
              <line
                x1={CENTRE}
                y1={CENTRE}
                x2={polar(CENTRE, CENTRE, RADIUS + 7, handAngle).x}
                y2={polar(CENTRE, CENTRE, RADIUS + 7, handAngle).y}
                stroke={palette.pillText}
                strokeWidth={1.1}
                strokeOpacity={0.62}
              />
              <circle
                cx={polar(CENTRE, CENTRE, RADIUS, handAngle).x}
                cy={polar(CENTRE, CENTRE, RADIUS, handAngle).y}
                r={3}
                fill={palette.pillText}
              />
            </>
          )}

          <circle cx={CENTRE} cy={CENTRE} r={2} fill={palette.text} fillOpacity={0.55} />
        </svg>

        {/* Centre readout, upright inside the rotated ring. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num-mono text-[19px] leading-none tracking-tight text-ivory">
            {now == null ? "--:--" : formatLocalClock(now, tz)}
          </span>
          <span className="label-micro-tight mt-1.5 text-ivory-40">
            {openNow.length === 0
              ? "Both closed"
              : openNow.length === 2
                ? "Both open"
                : `${openNow[0]?.code} open`}
          </span>
        </div>
      </div>

      {!compact && (
        /*
         * Each exchange is a two-row block, not a left/right split.
         *
         * The split version collapsed catastrophically in the Markets sidebar:
         * the countdown carried `shrink-0`, so on a ~90px column it claimed the
         * entire width and the label beside it wrapped one character per line.
         * Stacking removes the competition for horizontal space entirely, and
         * the container query below promotes it back to a row only where there
         * is genuinely room.
         */
        <dl className="min-w-0 flex-1 space-y-3.5">
          {exchanges.map((code) => {
            const ex = EXCHANGES[code];
            const state = now == null ? null : sessionState(code, new Date(now));
            const color = REGION_ACCENT[ex.region] ?? "#7ba7f0";

            return (
              <div key={code} className="min-w-0">
                <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: color }}
                  />
                  <span className="num-mono text-[12px] text-ivory">{code}</span>
                  {state?.isLive && <StatusDot tone="up" live />}
                  <span
                    className={cn(
                      "label-micro-tight ml-auto",
                      state?.isLive
                        ? "text-up"
                        : state?.phase === "pre"
                          ? "text-signal"
                          : "text-ivory-40",
                    )}
                  >
                    {state?.label ?? "—"}
                  </span>
                </dt>

                <dd className="mt-1.5 min-w-0 pl-4">
                  <p className="num-mono truncate text-[11px] text-ivory-60">
                    {state?.secondsToNextBoundary != null
                      ? `${state.nextBoundaryLabel} ${formatCountdown(state.secondsToNextBoundary)}`
                      : (state?.nextBoundaryLabel ?? "—")}
                  </p>
                  {/* The session window is the least important line here, so it
                      is the one that hides first on a narrow column. */}
                  <p className="mt-0.5 hidden truncate text-[10px] text-ivory-40 @[15rem]:block">
                    {formatSessionWindow(ex.open, ex.close)} · {formatOffset(ex.timezone)}
                  </p>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Arc between two angles. Sessions that cross local midnight come back with an
 * end angle behind the start, so the sweep is normalised into [0, 360) and the
 * large-arc flag derived from it rather than assumed.
 */
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const sweep = ((endDeg - startDeg) % 360 + 360) % 360;
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, startDeg + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function formatLocalClock(at: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(new Date(at));
}

function formatSessionWindow(open: number, close: number): string {
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(open)}–${fmt(close)}`;
}
