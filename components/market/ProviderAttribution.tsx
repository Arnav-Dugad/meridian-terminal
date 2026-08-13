"use client";

import { useEffect, useState } from "react";

import { Badge, Panel, PanelHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { IconExternal } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Which providers are live, what each covers, and how much budget is left.
 *
 * This exists because the system's behaviour is otherwise invisible. When
 * Indian quotes read "Simulated" while US ones read "Live", the reason is a
 * routing and coverage decision, not a bug — and the only honest way to
 * communicate that is to show the wiring. It doubles as the attribution these
 * free tiers ask for.
 */

interface ProviderRow {
  id: string;
  label: string;
  homepage: string;
  configured: boolean;
  envVar: string | null;
  capabilities: string[];
  coverage: string[];
  budget: { minute: number | null; day: number | null };
}

export function ProviderAttribution({ className }: { className?: string }) {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const body = (await res.json()) as { providers?: ProviderRow[] };
        if (!cancelled && body.providers) setRows(body.providers);
      } catch {
        /* the panel simply does not render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel flush className={className}>
      <PanelHeader
        title="Data providers"
        subtitle="Routed by coverage and remaining budget — the scarcest tier is spent last"
      />

      {rows === null ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line/60">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    row.configured ? "bg-up" : "bg-ivory-40",
                  )}
                  aria-hidden
                />
                <a
                  href={row.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group truncate text-[13px] text-ivory transition-colors hover:text-signal"
                >
                  {row.label}
                  <IconExternal className="ml-1.5 inline h-3 w-3 align-[-1px] opacity-0 transition-opacity group-hover:opacity-60" />
                </a>
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                {row.coverage.map((c) => (
                  <Badge
                    key={c}
                    tone={c === "IN" ? "india" : c === "US" ? "usa" : c === "CRYPTO" ? "crypto" : "neutral"}
                  >
                    {c}
                  </Badge>
                ))}
              </span>

              <span className="shrink-0 text-right">
                {row.configured ? (
                  <Tooltip
                    side="top"
                    content={
                      <span>
                        Remaining budget:{" "}
                        {row.budget.minute != null ? `${row.budget.minute} this minute` : "no minute cap"}
                        {row.budget.day != null ? `, ${row.budget.day} today` : ""}.
                        <br />
                        Covers: {row.capabilities.join(", ")}.
                      </span>
                    }
                  >
                    <span className="num-mono cursor-help text-[11px] text-up">
                      {row.budget.minute != null ? `${row.budget.minute}/min` : "active"}
                      {row.budget.day != null && (
                        <span className="ml-1.5 text-ivory-40">{row.budget.day}/day</span>
                      )}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="num-mono text-[11px] text-ivory-40">
                    {row.envVar ? `set ${row.envVar}` : "not configured"}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
        Quotes for US listings come from Finnhub, whose free tier allows sixty calls a
        minute. Indian listings route to Twelve Data because nothing else in this stack
        reaches NSE — and its free tier is eight credits a minute, which is why India is
        the first thing to fall back when budgets are tight.
      </p>
    </Panel>
  );
}
