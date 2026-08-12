"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { QuoteTable } from "@/components/market/QuoteTable";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { Badge, Button, EmptyState, Panel, Segmented } from "@/components/ui/primitives";
import { IconFilter, IconRefresh } from "@/components/ui/icons";
import { useQuotes } from "@/lib/hooks/market-data";
import { EQUITIES, SECTORS, SECTOR_HUE, type Sector } from "@/lib/market/universe";
import type { Region } from "@/lib/market/exchanges";
import { cn } from "@/lib/utils";

/**
 * The screener.
 *
 * Filtering happens on the client over quotes already in the shared store,
 * which is what makes the sliders feel instant — dragging a threshold does not
 * issue a request. The cost, and it is a real one, is that the candidate set
 * has to be bounded: every symbol in the pool is a Twelve Data credit, so the
 * pool is the largest names per region rather than every listing. That
 * trade-off is stated in the UI rather than hidden.
 */

const POOL_PER_REGION = 40;

type ChangeFilter = "any" | "up" | "down" | "big-up" | "big-down";
type RangeFilter = "any" | "near-high" | "near-low" | "mid";

const CHANGE_OPTIONS: { value: ChangeFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "big-up", label: "Up >2%" },
  { value: "big-down", label: "Down >2%" },
];

const RANGE_OPTIONS: { value: RangeFilter; label: string; help: string }[] = [
  { value: "any", label: "Any", help: "No constraint on where the price sits in its session." },
  { value: "near-high", label: "Near day high", help: "Top fifth of the session range — buyers in control into the close." },
  { value: "mid", label: "Mid range", help: "Middle of the session range." },
  { value: "near-low", label: "Near day low", help: "Bottom fifth of the session range." },
];

export function ScreenerView() {
  const [regions, setRegions] = useState<Region[]>(["IN", "US"]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("any");
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>("any");
  const [minChange, setMinChange] = useState(0);

  // The candidate pool is fixed so the subscription set is stable; filtering
  // then runs over quotes that are already streaming.
  const pool = useMemo(
    () =>
      (["IN", "US"] as Region[]).flatMap((r) =>
        EQUITIES.filter((i) => i.region === r)
          .sort((a, b) => b.seedCap - a.seedCap)
          .slice(0, POOL_PER_REGION),
      ),
    [],
  );

  const poolSlugs = useMemo(() => pool.map((i) => i.slug), [pool]);
  const { map, source, refresh } = useQuotes(poolSlugs);

  const results = useMemo(() => {
    return pool
      .filter((inst) => {
        if (!regions.includes(inst.region)) return false;
        if (sectors.length > 0 && !sectors.includes(inst.sector)) return false;

        const quote = map.get(inst.slug);
        // Unpriced names are kept so the table can show them loading rather
        // than having rows appear one by one as quotes land.
        if (!quote) return changeFilter === "any" && rangeFilter === "any" && minChange === 0;

        const chg = quote.changePercent;
        if (changeFilter === "up" && chg <= 0) return false;
        if (changeFilter === "down" && chg >= 0) return false;
        if (changeFilter === "big-up" && chg < 2) return false;
        if (changeFilter === "big-down" && chg > -2) return false;
        if (Math.abs(chg) < minChange) return false;

        if (rangeFilter !== "any") {
          const span = quote.dayHigh - quote.dayLow;
          const pos = span > 0 ? (quote.price - quote.dayLow) / span : 0.5;
          if (rangeFilter === "near-high" && pos < 0.8) return false;
          if (rangeFilter === "near-low" && pos > 0.2) return false;
          if (rangeFilter === "mid" && (pos < 0.35 || pos > 0.65)) return false;
        }

        return true;
      })
      .map((i) => i.slug);
  }, [pool, regions, sectors, changeFilter, rangeFilter, minChange, map]);

  const toggleRegion = (r: Region) =>
    setRegions((prev) =>
      prev.includes(r) ? (prev.length === 1 ? prev : prev.filter((x) => x !== r)) : [...prev, r],
    );

  const toggleSector = (s: Sector) =>
    setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const reset = () => {
    setRegions(["IN", "US"]);
    setSectors([]);
    setChangeFilter("any");
    setRangeFilter("any");
    setMinChange(0);
  };

  const activeFilters =
    (regions.length < 2 ? 1 : 0) +
    (sectors.length > 0 ? 1 : 0) +
    (changeFilter !== "any" ? 1 : 0) +
    (rangeFilter !== "any" ? 1 : 0) +
    (minChange > 0 ? 1 : 0);

  return (
    <>
      <PageHeader
        eyebrow="Screener"
        title="Filter both markets at once"
        description="A single candidate pool spanning NSE and US listings. Filters apply to live quotes already streaming into the terminal, so results update as the tape moves."
        meta={
          <>
            <DataSourceNotice source={source} />
            <Badge tone="neutral">
              {results.length} of {pool.length}
            </Badge>
            {activeFilters > 0 && <Badge tone="signal">{activeFilters} filters</Badge>}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="md" icon={<IconRefresh />} onClick={refresh}>
              Refresh
            </Button>
            {activeFilters > 0 && (
              <Button variant="ghost" size="md" onClick={reset}>
                Clear
              </Button>
            )}
          </>
        }
      />

      <PageBody className="space-y-5">
        <Panel>
          <div className="grid gap-6 lg:grid-cols-[auto_auto_1fr]">
            <div>
              <p className="label-micro mb-2.5 text-ivory-40">Market</p>
              <div className="flex gap-1.5">
                {(["IN", "US"] as Region[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => toggleRegion(r)}
                    aria-pressed={regions.includes(r)}
                    className={cn(
                      "rounded-sm border px-3 py-1.5 text-[12px] transition-colors duration-150",
                      regions.includes(r)
                        ? r === "IN"
                          ? "border-india/45 bg-india/[0.09] text-india"
                          : "border-usa/45 bg-usa/[0.09] text-usa"
                        : "border-line text-ivory-40 hover:border-line-bright hover:text-ivory-80",
                    )}
                  >
                    {r === "IN" ? "India" : "United States"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="label-micro mb-2.5 text-ivory-40">Direction</p>
              <Segmented
                value={changeFilter}
                onChange={setChangeFilter}
                layoutIdSuffix="screener-change"
                options={CHANGE_OPTIONS}
              />
            </div>

            <div>
              <p className="label-micro mb-2.5 text-ivory-40">Session position</p>
              <Segmented
                value={rangeFilter}
                onChange={setRangeFilter}
                layoutIdSuffix="screener-range"
                options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.help }))}
              />
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <p className="label-micro mb-2.5 text-ivory-40">Sector</p>
            <div className="flex flex-wrap gap-1.5">
              {SECTORS.map((s) => {
                const active = sectors.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSector(s)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] transition-colors duration-150",
                      active
                        ? "border-line-bright bg-ink-750 text-ivory"
                        : "border-line text-ivory-40 hover:border-line-bright hover:text-ivory-80",
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-[1px]"
                      style={{ backgroundColor: SECTOR_HUE[s], opacity: active ? 1 : 0.45 }}
                    />
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <label className="label-micro mb-3 flex items-baseline justify-between text-ivory-40">
              Minimum absolute move
              <span className="num-mono text-[12px] text-ivory">{minChange.toFixed(1)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={8}
              step={0.25}
              value={minChange}
              onChange={(e) => setMinChange(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-signal"
              aria-label="Minimum absolute percentage move"
            />
          </div>
        </Panel>

        <Panel flush>
          {results.length === 0 ? (
            <EmptyState
              icon={<IconFilter />}
              title="No instruments match"
              description="Loosen a filter, or widen the sector selection. The pool covers the largest names in each market."
              action={
                <Button variant="secondary" size="md" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
              <QuoteTable symbols={results} defaultSort="change" />
            </motion.div>
          )}
        </Panel>

        <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
          The candidate pool is the {POOL_PER_REGION} largest names in each market by
          capitalisation. Each symbol costs one Twelve Data credit per refresh, so the pool
          is bounded deliberately rather than covering every listing — on a paid plan this
          limit is a single constant in{" "}
          <Link href="/markets" className="text-ivory-60 underline underline-offset-2">
            the source
          </Link>
          .
        </p>
      </PageBody>
    </>
  );
}
