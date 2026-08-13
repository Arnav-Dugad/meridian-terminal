"use client";

import type { DataSource } from "@/lib/twelvedata/types";
import { Badge, Tooltip } from "@/components/ui/primitives";

/**
 * Provenance badge.
 *
 * The app will happily show simulated prices when the provider is unreachable
 * or unconfigured, which is only defensible if it says so. This is the label
 * that makes that true, and it appears next to every figure set whose origin
 * is not a live provider response.
 */

const COPY: Record<DataSource, { label: string; tone: "up" | "signal" | "neutral"; detail: string }> = {
  live: {
    label: "Live",
    tone: "up",
    detail: "Retrieved from a market data source on this request.",
  },
  cached: {
    label: "Cached",
    tone: "signal",
    detail:
      "Served from the last successful response rather than re-fetched — the source was rate-limited or briefly unreachable. These are real figures, just not this second's.",
  },
};

export function DataSourceNotice({
  source,
  notice,
  className,
}: {
  source: DataSource;
  notice?: string;
  className?: string;
}) {
  const copy = COPY[source];

  return (
    <Tooltip content={notice ?? copy.detail} side="bottom">
      <Badge tone={copy.tone} className={className}>
        {copy.label}
      </Badge>
    </Tooltip>
  );
}
