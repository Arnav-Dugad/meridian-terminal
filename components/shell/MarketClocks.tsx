"use client";

import { useEffect, useState } from "react";

import { EXCHANGES, formatCountdown, sessionState, type ExchangeCode } from "@/lib/market/exchanges";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/primitives";

/**
 * Session status for the topbar.
 *
 * Ticks once a second on the client only. Rendering a clock on the server
 * guarantees a hydration mismatch, so this deliberately shows nothing until
 * mounted rather than shipping a placeholder time that then jumps.
 */
export function MarketClocks({
  className,
  exchanges = ["NSE", "NASDAQ"] as ExchangeCode[],
}: {
  className?: string;
  exchanges?: ExchangeCode[];
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <div className={cn("h-8 w-[220px]", className)} aria-hidden />;

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {exchanges.map((code) => {
        const ex = EXCHANGES[code];
        const state = sessionState(code, now);
        const tone = state.isLive ? "up" : state.phase === "pre" ? "signal" : "neutral";

        return (
          <Tooltip
            key={code}
            side="bottom"
            content={
              <span>
                <strong className="text-ivory">{ex.name}</strong>
                <br />
                {state.label} · {state.localTime} local
                {state.secondsToNextBoundary != null && (
                  <>
                    <br />
                    {state.nextBoundaryLabel} {formatCountdown(state.secondsToNextBoundary)}
                  </>
                )}
              </span>
            }
          >
            <span className="flex items-center gap-2">
              <StatusDot tone={tone} live={state.isLive} />
              <span className="label-micro-tight text-ivory-60">{code}</span>
              <span className="num-mono text-[11px] text-ivory-80">{state.localTime}</span>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
