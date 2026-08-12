"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";

import type { SectorAggregate } from "@/lib/twelvedata/types";
import { formatPercent } from "@/lib/format";
import { SECTOR_HUE } from "@/lib/market/universe";
import { cn } from "@/lib/utils";
import { Segmented } from "@/components/ui/primitives";
import type { Region } from "@/lib/market/exchanges";

/**
 * Sector rotation, both regions on one axis.
 *
 * A conventional heatmap tiles sectors by weight and colours them by return,
 * which encodes the least interesting variable in the largest visual channel.
 * This inverts that: sectors are ranked, the bar length *is* the return, and
 * the two markets are drawn back to back so the comparison the product exists
 * to make — is energy leading in Mumbai the way it is in New York? — is a
 * single horizontal read rather than two charts and a memory test.
 */
export function SectorRotation({
  sectors,
  className,
}: {
  sectors: { IN: SectorAggregate[]; US: SectorAggregate[] };
  className?: string;
}) {
  const [mode, setMode] = useState<"both" | Region>("both");

  const rows = useMemo(() => {
    const names = Array.from(
      new Set([...sectors.IN.map((s) => s.sector), ...sectors.US.map((s) => s.sector)]),
    );

    const merged = names.map((sector) => ({
      sector,
      india: sectors.IN.find((s) => s.sector === sector) ?? null,
      usa: sectors.US.find((s) => s.sector === sector) ?? null,
    }));

    // Rank by whichever market is in view, so the ordering answers the
    // question the reader just asked with the toggle.
    return merged.sort((a, b) => {
      const score = (r: (typeof merged)[number]) =>
        mode === "IN"
          ? (r.india?.changePercent ?? -99)
          : mode === "US"
            ? (r.usa?.changePercent ?? -99)
            : ((r.india?.changePercent ?? 0) + (r.usa?.changePercent ?? 0)) / 2;
      return score(b) - score(a);
    });
  }, [sectors, mode]);

  // One shared scale across both markets, or the bars lie about magnitude.
  const extent = useMemo(() => {
    let max = 0.6;
    for (const r of rows) {
      max = Math.max(max, Math.abs(r.india?.changePercent ?? 0), Math.abs(r.usa?.changePercent ?? 0));
    }
    return max * 1.12;
  }, [rows]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-4 pb-3">
        <p className="label-micro text-ivory-40">
          Cap-weighted move by sector · shared scale ±{extent.toFixed(1)}%
        </p>
        <Segmented
          value={mode}
          onChange={setMode}
          layoutIdSuffix="sector-rotation"
          options={[
            { value: "both", label: "Both" },
            { value: "IN", label: "India" },
            { value: "US", label: "US" },
          ]}
        />
      </div>

      <div className="space-y-px">
        {rows.map((row, i) => (
          <SectorRow
            key={row.sector}
            sector={row.sector}
            india={row.india}
            usa={row.usa}
            extent={extent}
            mode={mode}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

function SectorRow({
  sector,
  india,
  usa,
  extent,
  mode,
  index,
}: {
  sector: string;
  india: SectorAggregate | null;
  usa: SectorAggregate | null;
  extent: number;
  mode: "both" | Region;
  index: number;
}) {
  const hue = SECTOR_HUE[sector as keyof typeof SECTOR_HUE] ?? "#8f9bb3";
  const show = { india: mode !== "US", usa: mode !== "IN" };

  return (
    <div className="group grid grid-cols-[100px_1fr] items-center gap-3 px-4 py-2 transition-colors hover:bg-ink-850 sm:grid-cols-[132px_1fr]">
      <p className="flex items-center gap-2 truncate">
        <span className="h-2.5 w-[2px] shrink-0 rounded-full" style={{ backgroundColor: hue }} />
        <span className="truncate text-[11px] text-ivory-80">{sector}</span>
      </p>

      <div className="space-y-1">
        {show.india && <Bar data={india} extent={extent} label="IN" index={index} />}
        {show.usa && <Bar data={usa} extent={extent} label="US" index={index} />}
      </div>
    </div>
  );
}

function Bar({
  data,
  extent,
  label,
  index,
}: {
  data: SectorAggregate | null;
  extent: number;
  label: string;
  index: number;
}) {
  if (!data) {
    return (
      <div className="flex items-center gap-2">
        <span className="label-micro-tight w-[18px] shrink-0 text-ivory-25">{label}</span>
        <span className="text-[10px] text-ivory-25">no coverage</span>
      </div>
    );
  }

  const value = data.changePercent;
  const magnitude = Math.min(1, Math.abs(value) / extent);
  const positive = value >= 0;

  const leader = data.leaders[0];

  return (
    <div className="flex items-center gap-2">
      <span className="label-micro-tight w-[18px] shrink-0 text-ivory-40">{label}</span>

      {/* Zero sits at the centre, so direction is a position, not a colour. */}
      <div className="relative h-3 flex-1">
        <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong" aria-hidden />
        <motion.span
          className={cn("absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]", positive ? "bg-up/75" : "bg-down/75")}
          style={positive ? { left: "50%" } : { right: "50%" }}
          initial={{ width: 0 }}
          animate={{ width: `${magnitude * 50}%` }}
          transition={{ duration: 0.7, delay: 0.02 * index, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <span
        className={cn(
          "num-mono w-[52px] shrink-0 text-right text-[11px]",
          positive ? "text-up" : "text-down",
        )}
      >
        {formatPercent(value)}
      </span>

      {leader && (
        <Link
          href={`/stock/${encodeURIComponent(leader.slug)}`}
          className="num-mono hidden w-[74px] shrink-0 truncate text-[10px] text-ivory-25 transition-colors hover:text-ivory-60 xl:block"
          title={`Largest mover: ${leader.symbol}`}
        >
          {leader.symbol}
        </Link>
      )}
    </div>
  );
}
