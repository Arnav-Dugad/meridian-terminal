"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { ComparisonChart, type ComparisonSeries } from "@/components/chart/ComparisonChart";
import {
  CorrelationNetwork,
  type NetworkEdge,
  type NetworkNode,
} from "@/components/chart/CorrelationNetwork";
import { Badge, Button, EmptyState, Input, Panel, PanelHeader, Segmented, Tooltip } from "@/components/ui/primitives";
import { IconClose, IconPlus, IconScale, IconSearch } from "@/components/ui/icons";
import { useMultiSeries } from "@/lib/hooks/use-series";
import { findBySlug, searchUniverse } from "@/lib/market/universe";
import { RANGE_KEYS, RANGE_SPEC, type RangeKey } from "@/lib/twelvedata/types";
import {
  annualisedVolatility,
  correlation,
  logReturns,
  maxDrawdown,
  sharpe,
} from "@/lib/analytics/indicators";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The comparison workbench.
 *
 * Deliberately seeded with one Indian name, one US name and both indices,
 * because the empty state of a comparison tool teaches nothing. The default
 * selection demonstrates the product's actual claim in the first frame.
 */

const PALETTE = ["#f0a63c", "#7ba7f0", "#3fbf7f", "#d67ef0", "#4fd1c5", "#f0563f"];
const MAX_SERIES = 6;

const DEFAULT_SELECTION = ["NIFTY50", "SPX", "TCS.NSE", "NVDA"];

export function CompareView() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [query, setQuery] = useState("");
  const [networkThreshold, setNetworkThreshold] = useState(0.4);
  const router = useRouter();

  const { series, loading } = useMultiSeries(selected, range);

  const chartSeries = useMemo<ComparisonSeries[]>(
    () =>
      selected.flatMap((slug, i) => {
        const s = series.get(slug);
        const inst = findBySlug(slug);
        if (!s || !inst) return [];
        return [
          {
            slug,
            label: inst.symbol,
            color: PALETTE[i % PALETTE.length]!,
            candles: s.candles,
          },
        ];
      }),
    [selected, series],
  );

  const stats = useMemo(() => {
    const periodsPerYear =
      RANGE_SPEC[range].interval === "1week" ? 52 : RANGE_SPEC[range].interval === "1month" ? 12 : 252;

    return chartSeries.map((s) => {
      const closes = s.candles.map((c) => c.c);
      const rets = logReturns(closes);
      const first = closes[0] ?? 0;
      const last = closes[closes.length - 1] ?? 0;
      const inst = findBySlug(s.slug);

      return {
        slug: s.slug,
        label: s.label,
        color: s.color,
        region: inst?.region ?? "US",
        totalReturn: first > 0 ? ((last - first) / first) * 100 : 0,
        volatility: annualisedVolatility(rets, periodsPerYear),
        drawdown: maxDrawdown(closes).depth,
        sharpe: sharpe(rets, inst?.currency === "INR" ? 0.066 : 0.042, periodsPerYear),
        returns: rets,
      };
    });
  }, [chartSeries, range]);

  // Pairwise correlation over the overlapping tail of each return series.
  const matrix = useMemo(() => {
    return stats.map((a) => stats.map((b) => (a.slug === b.slug ? 1 : correlation(a.returns, b.returns))));
  }, [stats]);

  /* ── Network view ────────────────────────────────────────────────────────
     The same correlations, laid out as a graph. Nodes carry region and weight
     so the simulation can colour and size them without another lookup. */
  const networkNodes = useMemo<NetworkNode[]>(
    () =>
      stats.map((s) => {
        const inst = findBySlug(s.slug);
        return {
          id: s.slug,
          label: s.label,
          weight: inst?.seedCap ?? 1,
          region: (inst?.region ?? "US") as NetworkNode["region"],
          changePercent: s.totalReturn,
        };
      }),
    [stats],
  );

  const networkEdges = useMemo<NetworkEdge[]>(() => {
    const out: NetworkEdge[] = [];
    for (let i = 0; i < stats.length; i++) {
      for (let j = i + 1; j < stats.length; j++) {
        out.push({
          source: stats[i]!.slug,
          target: stats[j]!.slug,
          correlation: matrix[i]?.[j] ?? 0,
        });
      }
    }
    return out;
  }, [stats, matrix]);

  const suggestions = useMemo(
    () => (query.trim() ? searchUniverse(query, 6).filter((i) => !selected.includes(i.slug)) : []),
    [query, selected],
  );

  const add = (slug: string) => {
    if (selected.length >= MAX_SERIES || selected.includes(slug)) return;
    setSelected((prev) => [...prev, slug]);
    setQuery("");
  };

  const remove = (slug: string) => setSelected((prev) => prev.filter((s) => s !== slug));

  return (
    <>
      <PageHeader
        eyebrow="Compare"
        title="Rebased to a common start"
        description="Every series is set to 100 at the left edge, so vertical distance is difference in return rather than difference in price. Correlation and risk figures are computed in the browser from the same bars."
        meta={
          <>
            <Badge tone="neutral">{selected.length} of {MAX_SERIES}</Badge>
            <Badge tone="signal">{RANGE_SPEC[range].label}</Badge>
          </>
        }
        actions={
          <Segmented
            value={range}
            onChange={(r) => setRange(r as RangeKey)}
            layoutIdSuffix="compare-range"
            options={RANGE_KEYS.filter((k) => k !== "1D").map((k) => ({
              value: k,
              label: k,
              title: RANGE_SPEC[k].label,
            }))}
          />
        }
      />

      <PageBody className="space-y-5">
        {/* Selection */}
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <AnimatePresence mode="popLayout">
              {selected.map((slug, i) => {
                const inst = findBySlug(slug);
                if (!inst) return null;
                return (
                  <motion.span
                    key={slug}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-2 rounded-sm border border-line-strong bg-ink-850 py-1.5 pl-2 pr-1"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="num-mono text-[12px] text-ivory">{inst.symbol}</span>
                    <span className="hidden max-w-[16ch] truncate text-[11px] text-ivory-40 sm:block">
                      {inst.name}
                    </span>
                    <button
                      onClick={() => remove(slug)}
                      className="rounded-sm p-1 text-ivory-40 transition-colors hover:bg-ink-800 hover:text-ivory"
                      aria-label={`Remove ${inst.symbol}`}
                    >
                      <IconClose className="h-3 w-3" />
                    </button>
                  </motion.span>
                );
              })}
            </AnimatePresence>

            {selected.length < MAX_SERIES && (
              <div className="relative min-w-[210px] flex-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Add an instrument…"
                  leading={<IconSearch />}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions[0]) add(suggestions[0].slug);
                    if (e.key === "Escape") setQuery("");
                  }}
                />

                {suggestions.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-sm border border-line-strong bg-ink-850 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]"
                  >
                    {suggestions.map((inst) => (
                      <li key={inst.slug}>
                        <button
                          onClick={() => add(inst.slug)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink-800"
                        >
                          <IconPlus className="h-3 w-3 shrink-0 text-ivory-40" />
                          <span className="num-mono text-[12px] text-ivory">{inst.symbol}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-ivory-40">
                            {inst.name}
                          </span>
                          <Badge tone={inst.region === "IN" ? "india" : "usa"}>
                            {inst.exchange}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </div>
            )}
          </div>
        </Panel>

        {/* Chart */}
        <Panel flush>
          <PanelHeader
            title="Relative performance"
            subtitle="Indexed to 100 at the start of the range"
            action={
              loading ? (
                <span className="label-micro flex items-center gap-2 text-ivory-40">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-signal" />
                  Loading
                </span>
              ) : null
            }
          />
          <div className="p-3">
            {selected.length === 0 ? (
              <EmptyState
                icon={<IconScale />}
                title="Nothing selected"
                description="Add up to six instruments to compare their returns on a common basis."
              />
            ) : (
              <ComparisonChart series={chartSeries} height={420} />
            )}
          </div>
        </Panel>

        {/* Network view — the matrix says how much each pair moves together;
            the graph shows the shape that emerges from all of them at once. */}
        {stats.length > 2 && (
          <Panel flush>
            <PanelHeader
              title="Correlation map"
              subtitle="Connected instruments move together — the closer they sit, the tighter the link"
              action={
                <div className="flex items-center gap-2">
                  <span className="label-micro text-ivory-40">
                    ≥ {networkThreshold.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={networkThreshold}
                    onChange={(e) => setNetworkThreshold(Number(e.target.value))}
                    className="h-1 w-[110px] cursor-pointer appearance-none rounded-full bg-ink-700 accent-signal"
                    aria-label="Correlation threshold"
                  />
                </div>
              }
            />
            <CorrelationNetwork
              nodes={networkNodes}
              edges={networkEdges}
              threshold={networkThreshold}
              height={440}
              onSelect={(id) => router.push(`/stock/${encodeURIComponent(id)}`)}
            />
            <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
              Solid lines are positive correlation, dashed red lines negative. Node size is
              relative weight. Drag the threshold to strip out weak relationships — what
              survives above 0.6 is genuine structure, and anything that sits between the
              two regional clusters is a name that bridges both markets.
            </p>
          </Panel>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
          {/* Risk table */}
          <Panel flush>
            <PanelHeader title="Risk and return" subtitle={`Over ${RANGE_SPEC[range].label}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className="label-micro px-4 py-2.5 text-left font-medium text-ivory-40">
                      Instrument
                    </th>
                    <th className="label-micro px-4 py-2.5 text-right font-medium text-ivory-40">
                      Return
                    </th>
                    <th className="label-micro px-4 py-2.5 text-right font-medium text-ivory-40">
                      Volatility
                    </th>
                    <th className="label-micro px-4 py-2.5 text-right font-medium text-ivory-40">
                      Max drawdown
                    </th>
                    <th className="label-micro px-4 py-2.5 text-right font-medium text-ivory-40">
                      Sharpe
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats
                    .slice()
                    .sort((a, b) => b.totalReturn - a.totalReturn)
                    .map((s) => (
                      <tr key={s.slug} className="border-b border-line/60 hover:bg-ink-850">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{ backgroundColor: s.color }}
                            />
                            <span className="num-mono text-[12px] text-ivory">{s.label}</span>
                            <Badge tone={s.region === "IN" ? "india" : "usa"}>{s.region}</Badge>
                          </span>
                        </td>
                        <td
                          className={cn(
                            "num-mono px-4 py-2.5 text-right text-[12px]",
                            s.totalReturn >= 0 ? "text-up" : "text-down",
                          )}
                        >
                          {formatPercent(s.totalReturn)}
                        </td>
                        <td className="num-mono px-4 py-2.5 text-right text-[12px] text-ivory-60">
                          {s.volatility.toFixed(1)}%
                        </td>
                        <td className="num-mono px-4 py-2.5 text-right text-[12px] text-down">
                          −{s.drawdown.toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "num-mono px-4 py-2.5 text-right text-[12px]",
                            s.sharpe > 0.5 ? "text-up" : s.sharpe < 0 ? "text-down" : "text-ivory-60",
                          )}
                        >
                          {s.sharpe.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Correlation matrix */}
          {stats.length > 1 && (
            <Panel flush className="lg:w-auto">
              <PanelHeader
                title="Correlation"
                subtitle="Pearson, on log returns over the range"
              />
              <div className="overflow-x-auto p-4">
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th />
                      {stats.map((s) => (
                        <th
                          key={s.slug}
                          className="num-mono px-1 pb-2 text-[10px] font-medium text-ivory-40"
                        >
                          {s.label.slice(0, 6)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((rowStat, i) => (
                      <tr key={rowStat.slug}>
                        <th className="num-mono pr-2.5 text-right text-[10px] font-medium text-ivory-40">
                          {rowStat.label.slice(0, 8)}
                        </th>
                        {stats.map((colStat, j) => {
                          const r = matrix[i]?.[j] ?? 0;
                          return (
                            <td key={colStat.slug} className="p-0.5">
                              <Tooltip
                                content={`${rowStat.label} vs ${colStat.label}: ${r.toFixed(3)}`}
                              >
                                <motion.span
                                  initial={{ opacity: 0, scale: 0.85 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, delay: (i + j) * 0.02 }}
                                  className="num-mono flex h-9 w-11 items-center justify-center rounded-[3px] text-[10px]"
                                  style={{
                                    backgroundColor: correlationColor(r),
                                    color: Math.abs(r) > 0.55 ? "#0b0b0d" : "#c9c6bd",
                                  }}
                                >
                                  {i === j ? "—" : r.toFixed(2)}
                                </motion.span>
                              </Tooltip>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="mt-4 max-w-[36ch] text-[11px] leading-relaxed text-ivory-40">
                  Values near +1 move together; near −1 move opposite; near 0 are
                  independent. Cross-market pairs sitting above 0.5 are the ones where an
                  overnight move in one is worth watching in the other.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </PageBody>
    </>
  );
}

/** Diverging scale: green for positive, red for negative, ink at zero. */
function correlationColor(r: number): string {
  const magnitude = Math.min(1, Math.abs(r));
  if (r >= 0) return `rgba(63, 191, 127, ${0.08 + magnitude * 0.76})`;
  return `rgba(240, 86, 63, ${0.08 + magnitude * 0.76})`;
}
