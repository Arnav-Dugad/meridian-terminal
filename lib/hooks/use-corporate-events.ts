"use client";

import { useEffect, useState } from "react";

import type { ChartEvent } from "@/components/chart/engine";

/**
 * Corporate actions, shaped for the chart's event overlay.
 *
 * Only fetched for Indian listings, because that is the only market the
 * corporate-actions source covers. Failures are silent by design: a missing
 * marker degrades the chart's annotation, not the chart, and an error banner
 * over a working price series would be the wrong trade.
 */

interface Action {
  symbol: string;
  slug: string | null;
  kind: string;
  subject: string;
  value: number | null;
  ratio: string | null;
  exDate: string;
}

const GLYPH: Record<string, { glyph: string; color: string }> = {
  dividend: { glyph: "D", color: "#3fbf7f" },
  split: { glyph: "S", color: "#f0a63c" },
  bonus: { glyph: "B", color: "#4fd1c5" },
  rights: { glyph: "R", color: "#7ba7f0" },
  buyback: { glyph: "K", color: "#f0a63c" },
};

export function useCorporateActionEvents(slug: string, enabled: boolean): ChartEvent[] {
  const [events, setEvents] = useState<ChartEvent[]>([]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        // A wide window so past ex-dates already on the chart are marked, not
        // only upcoming ones.
        const res = await fetch("/api/corporate-actions?days=90", { signal: controller.signal });
        if (!res.ok) return;

        const body = (await res.json()) as { data: Action[] };
        if (cancelled) return;

        const mine = body.data.filter((a) => a.slug === slug && GLYPH[a.kind]);
        setEvents(
          mine.map((a) => {
            const style = GLYPH[a.kind]!;
            const detail =
              a.kind === "dividend" && a.value != null
                ? `₹${a.value} per share`
                : (a.ratio ?? a.subject);
            return {
              t: Date.parse(`${a.exDate}T00:00:00Z`),
              glyph: style.glyph,
              label: `${a.kind}: ${detail}`,
              color: style.color,
            };
          }),
        );
      } catch {
        // Silent — an unmarked chart is still a correct chart.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, enabled]);

  return events;
}
