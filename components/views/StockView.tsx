"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { PriceChart, INDICATOR_CATALOGUE } from "@/components/chart/PriceChart";
import { RangeBar } from "@/components/market/RangeBar";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import { AlertComposer } from "@/components/market/AlertComposer";
import { NewsPanel } from "@/components/market/NewsFeed";
import { InstrumentNotes } from "@/components/market/InstrumentNotes";
import { BacktestPanel } from "@/components/market/BacktestPanel";
import { OptionsPanel } from "@/components/market/OptionsPanel";
import { DriftPanel } from "@/components/market/DriftPanel";
import { SeasonalityPanel } from "@/components/market/SeasonalityPanel";
import { InsiderPanel } from "@/components/market/InsiderPanel";
import { PeerValuation } from "@/components/market/PeerValuation";
import { OwnershipPanel } from "@/components/market/OwnershipPanel";
import type { Ownership, RatingChange } from "@/lib/providers/yahoo-summary";
import { useCorporateActionEvents } from "@/lib/hooks/use-corporate-events";
import {
  AnalystPanel,
  EarningsPanel,
  FundamentalsPanel,
  PeersPanel,
} from "@/components/market/ResearchPanels";
import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
} from "@/lib/providers/types";
import {
  Badge,
  Button,
  Delta,
  Panel,
  PanelHeader,
  Segmented,
  Tooltip,
} from "@/components/ui/primitives";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { IconBell, IconStar, IconStarFilled } from "@/components/ui/icons";

import { useQuote } from "@/lib/hooks/market-data";
import { useSeries } from "@/lib/hooks/use-series";
import { usePersonal } from "@/lib/store/personal";
import { findBySlug } from "@/lib/market/universe";
import { EXCHANGES, sessionState } from "@/lib/market/exchanges";
import type { Candle, CompanyProfile, DataSource, Quote, RangeKey, Series } from "@/lib/twelvedata/types";
import { RANGE_KEYS, RANGE_SPEC } from "@/lib/twelvedata/types";
import {
  annualisedVolatility,
  beta,
  correlation,
  logReturns,
  maxDrawdown,
  pivotLevels,
  sharpe,
  STANCE_LABEL,
  technicalRead,
} from "@/lib/analytics/indicators";
import {
  formatCompact,
  formatCompactMoney,
  formatPercent,
  formatPrice,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function StockView({
  slug,
  initialQuote,
  initialSeries,
  profile,
  benchmark,
  crossMarket,
  source,
  notice,
  initialNotice,
}: {
  slug: string;
  initialQuote: Quote;
  initialSeries: Series;
  /** Why the server-rendered series is empty, when it is. */
  initialNotice?: string;
  profile: CompanyProfile | null;
  benchmark: { slug: string; candles: Candle[] } | null;
  crossMarket: { slug: string; candles: Candle[] } | null;
  source: DataSource;
  notice?: string;
}) {
  const instrument = findBySlug(slug);
  const { preferences, setPreference, isWatched, toggleWatch } = usePersonal();

  const [range, setRange] = useState<RangeKey>(initialSeries.range);
  const [composerOpen, setComposerOpen] = useState(false);
  const chartHeight = useResponsiveChartHeight();

  const { quote: liveQuote } = useQuote(slug);
  const quote = liveQuote ?? initialQuote;

  const research = useResearch(slug, instrument?.kind === "equity");

  // Dividends and splits marked on the chart, so an ex-date drop explains
  // itself where the reader actually sees it.
  const chartEvents = useCorporateActionEvents(slug, instrument?.region === "IN");

  // Feeds the command palette's recent list and the dashboard's history.
  const { recordView } = usePersonal();
  useEffect(() => {
    recordView(slug);
  }, [slug, recordView]);

  const { series, loading, error } = useSeries(slug, range, initialSeries);
  const candles = series?.candles ?? initialSeries.candles;
  const seriesNotice = error ?? initialNotice ?? null;

  const currency = quote.currency;
  const exchange = instrument ? EXCHANGES[instrument.exchange] : null;
  const session = instrument ? sessionState(instrument.exchange) : null;
  const watched = isWatched(slug);
  const isIntraday = RANGE_SPEC[range].interval.includes("min") || RANGE_SPEC[range].interval === "1h";

  /* ── Derived analytics ──────────────────────────────────────────────────
     All computed from bars already on the client — no extra requests. */
  const stats = useMemo(() => {
    const closes = candles.map((c) => c.c);
    if (closes.length < 5) return null;

    const rets = logReturns(closes);
    const periodsPerYear =
      RANGE_SPEC[range].interval === "1week" ? 52 : RANGE_SPEC[range].interval === "1month" ? 12 : 252;

    const first = closes[0] ?? 0;
    const last = closes[closes.length - 1] ?? 0;

    return {
      periodReturn: first > 0 ? ((last - first) / first) * 100 : 0,
      volatility: annualisedVolatility(rets, periodsPerYear),
      drawdown: maxDrawdown(closes),
      sharpe: sharpe(rets, currency === "INR" ? 0.066 : 0.042, periodsPerYear),
      read: technicalRead(candles),
      pivots: pivotLevels(candles),
    };
  }, [candles, range, currency]);

  const crossStats = useMemo(() => {
    const closes = candles.map((c) => c.c);
    if (closes.length < 8) return null;
    const rets = logReturns(closes);

    const against = (other: { slug: string; candles: Candle[] } | null) => {
      if (!other || other.candles.length < 8) return null;
      const otherRets = logReturns(other.candles.map((c) => c.c));
      return {
        slug: other.slug,
        correlation: correlation(rets, otherRets),
        beta: beta(rets, otherRets),
      };
    };

    return { home: against(benchmark), cross: against(crossMarket) };
  }, [candles, benchmark, crossMarket]);

  const levels = useMemo(
    () =>
      (stats?.pivots ?? []).slice(0, 3).map((p) => ({
        price: p.price,
        label: `${p.kind === "support" ? "S" : "R"} ${formatPrice(p.price, currency, { withSymbol: false })}`,
        color: p.kind === "support" ? "#3fbf7f" : "#f0563f",
      })),
    [stats?.pivots, currency],
  );

  const toggleIndicator = (id: string) => {
    const next = preferences.indicators.includes(id)
      ? preferences.indicators.filter((x) => x !== id)
      : [...preferences.indicators, id];
    setPreference("indicators", next);
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {instrument?.exchange} · {exchange?.country}
            <span className="text-ivory-25">/</span>
            {instrument?.sector}
          </span>
        }
        title={quote.name}
        // For a fund, what it holds is more useful than any price statistic.
        description={instrument?.mandate}
        meta={
          <>
            <Badge tone={instrument?.region === "IN" ? "india" : "usa"}>{quote.symbol}</Badge>
            <DataSourceNotice source={source} notice={notice} />
            {session && (
              <Badge tone={session.isLive ? "up" : "neutral"}>{session.label}</Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant={watched ? "secondary" : "outline"}
              size="md"
              onClick={() => toggleWatch(slug)}
              icon={watched ? <IconStarFilled className="text-signal" /> : <IconStar />}
            >
              {watched ? "Watching" : "Watch"}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<IconBell />}
              onClick={() => setComposerOpen(true)}
            >
              Alert
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        {/* ── Price header ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="min-w-0">
            {/* Clamped rather than stepped: a six-figure index print and a
                sub-dollar coin both have to fit the same slot. */}
            <p className="num-mono text-[clamp(2rem,9vw,3.25rem)] leading-none tracking-tight text-ivory">
              <AnimatedNumber value={quote.price} format={(v) => formatPrice(v, currency)} flash />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <Delta
                value={quote.changePercent}
                absolute={`${quote.change >= 0 ? "+" : ""}${formatPrice(quote.change, currency, { withSymbol: false })}`}
                size="lg"
              />
              <span className="text-[12px] text-ivory-40">
                {instrument?.kind === "crypto" ? "over 24 hours" : "vs previous close"}{" "}
                {formatPrice(quote.previousClose, currency)}
              </span>
            </div>
          </div>

          {/* A two-column grid on phones instead of a row that overflows. */}
          <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-4 sm:w-auto sm:flex sm:flex-wrap sm:gap-x-8">
            <MiniStat
              label={instrument?.kind === "crypto" ? "24h open" : "Open"}
              value={formatPrice(quote.open, currency)}
            />
            <MiniStat label="High" value={formatPrice(quote.dayHigh, currency)} />
            <MiniStat label="Low" value={formatPrice(quote.dayLow, currency)} />
            <MiniStat
              label="Volume"
              value={quote.volume > 0 ? formatCompact(quote.volume, currency) : "—"}
            />
            <MiniStat label="Market cap" value={formatCompactMoney(quote.marketCap, currency)} />
          </dl>
        </div>

        {/* ── Chart ────────────────────────────────────────────────────── */}
        <Panel flush>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-b border-line px-3 py-3 sm:px-4">
            <Segmented
              value={range}
              onChange={(r) => setRange(r as RangeKey)}
              layoutIdSuffix="stock-range"
              options={RANGE_KEYS.map((k) => ({ value: k, label: k, title: RANGE_SPEC[k].label }))}
            />

            <Segmented
              value={preferences.chartStyle}
              onChange={(v) => setPreference("chartStyle", v as "area" | "candles")}
              layoutIdSuffix="stock-style"
              options={[
                { value: "area", label: "Area" },
                { value: "candles", label: "Candles" },
              ]}
            />

            {/* Indicators get their own scrolling row so they never squeeze
                the range picker onto a second line on a phone. */}
            <div className="scroll-x -mx-1 flex w-full items-center gap-1 px-1 lg:mx-0 lg:w-auto lg:px-0">
              {INDICATOR_CATALOGUE.map((ind) => {
                const active = preferences.indicators.includes(ind.id);
                return (
                  <button
                    key={ind.id}
                    onClick={() => toggleIndicator(ind.id)}
                    aria-pressed={active}
                    className={cn(
                      "label-micro-tight shrink-0 whitespace-nowrap rounded-[3px] border px-2 py-1.5 transition-all duration-150",
                      active
                        ? "border-transparent text-ink-1000"
                        : "border-line text-ivory-40 hover:border-line-bright hover:text-ivory-80",
                    )}
                    style={active ? { backgroundColor: ind.color } : undefined}
                  >
                    {ind.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-1 pb-2 pt-3 sm:px-2">
            <PriceChart
              candles={candles}
              currency={currency}
              style={preferences.chartStyle}
              indicators={preferences.indicators}
              baseline={quote.previousClose}
              intraday={isIntraday}
              loading={loading}
              height={chartHeight}
              events={chartEvents}
              unavailableReason={seriesNotice}
            />
          </div>
        </Panel>

        {/* ── Analytics ────────────────────────────────────────────────── */}
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Technical read */}
          <Panel flush className="lg:col-span-2">
            <PanelHeader
              title="Technical read"
              subtitle={`Blended across trend, momentum and volatility over ${RANGE_SPEC[range].label}`}
              action={
                stats && (
                  <span
                    className={cn(
                      "label-micro rounded-[3px] px-2 py-1",
                      stats.read.score >= 2
                        ? "bg-up/12 text-up"
                        : stats.read.score <= -2
                          ? "bg-down/12 text-down"
                          : "bg-ink-750 text-ivory-60",
                    )}
                  >
                    {STANCE_LABEL[stats.read.stance]}
                  </span>
                )
              }
            />

            {stats ? (
              <div className="divide-y divide-line/60">
                {stats.read.signals.map((signal, i) => (
                  <motion.div
                    key={signal.label}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.05 }}
                    className="flex items-start justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] text-ivory">{signal.label}</p>
                      <p className="mt-0.5 text-[11px] text-ivory-40">{signal.detail}</p>
                    </div>
                    <span
                      className={cn(
                        "label-micro-tight shrink-0 rounded-[3px] px-1.5 py-1",
                        signal.verdict === "bullish"
                          ? "bg-up/12 text-up"
                          : signal.verdict === "bearish"
                            ? "bg-down/12 text-down"
                            : "bg-ink-750 text-ivory-60",
                      )}
                    >
                      {signal.verdict}
                    </span>
                  </motion.div>
                ))}

                <p className="px-4 py-3 text-[11px] leading-relaxed text-ivory-40">
                  A summary of what the indicators say over the selected range, not a
                  recommendation. Indicators describe what price has already done.
                </p>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-[12px] text-ivory-40">
                Not enough history in this range to compute a read.
              </p>
            )}
          </Panel>

          {/* Ranges + risk */}
          <div className="space-y-5">
            <Panel>
              <p className="label-micro mb-4 text-ivory-40">Ranges</p>

              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-[11px] text-ivory-60">Session</p>
                  <RangeBar
                    low={quote.dayLow}
                    high={quote.dayHigh}
                    value={quote.price}
                    currency={currency}
                    showLabels
                  />
                </div>

                {quote.fiftyTwoWeekLow != null && quote.fiftyTwoWeekHigh != null && (
                  <div>
                    <p className="mb-2 flex items-baseline justify-between text-[11px] text-ivory-60">
                      52 weeks
                      {quote.fiftyTwoWeekPosition != null && (
                        <span className="num-mono text-ivory-40">
                          {(quote.fiftyTwoWeekPosition * 100).toFixed(0)}% of band
                        </span>
                      )}
                    </p>
                    <RangeBar
                      low={quote.fiftyTwoWeekLow}
                      high={quote.fiftyTwoWeekHigh}
                      value={quote.price}
                      currency={currency}
                      showLabels
                    />
                  </div>
                )}
              </div>
            </Panel>

            {stats && (
              <Panel>
                <p className="label-micro mb-4 text-ivory-40">
                  Risk · {RANGE_SPEC[range].label}
                </p>
                <dl className="space-y-2.5">
                  <StatRow
                    label="Period return"
                    value={formatPercent(stats.periodReturn)}
                    tone={stats.periodReturn}
                  />
                  <StatRow
                    label="Annualised volatility"
                    value={`${stats.volatility.toFixed(1)}%`}
                    hint="Standard deviation of log returns, scaled to a year."
                  />
                  <StatRow
                    label="Max drawdown"
                    value={`−${stats.drawdown.depth.toFixed(1)}%`}
                    tone={-1}
                    hint="Deepest peak-to-trough decline inside the range."
                  />
                  <StatRow
                    label="Sharpe"
                    value={stats.sharpe.toFixed(2)}
                    tone={stats.sharpe}
                    hint={`Excess return per unit of volatility, against a ${currency === "INR" ? "6.6%" : "4.2%"} risk-free rate.`}
                  />
                </dl>
              </Panel>
            )}
          </div>
        </div>

        {/* ── Cross-market ─────────────────────────────────────────────── */}
        {crossStats && (crossStats.home || crossStats.cross) && (
          <Panel flush>
            <PanelHeader
              title="Cross-market behaviour"
              subtitle="How this name has moved with each index over the selected range"
            />
            <div className="grid gap-px bg-line sm:grid-cols-2">
              {crossStats.home && (
                <CorrelationCard
                  title="Home index"
                  {...crossStats.home}
                  description="How much of this name's movement is simply its own market."
                />
              )}
              {crossStats.cross && (
                <CorrelationCard
                  title="Across the meridian"
                  {...crossStats.cross}
                  description="Coupling to the other market — the read-across an overnight gap tends to follow."
                />
              )}
            </div>
          </Panel>
        )}

        {/* ── Research ─────────────────────────────────────────────────────
            Only equities have fundamentals, analyst coverage and earnings.
            Rendering empty shells for an index or a coin would be noise. */}
        {instrument?.kind === "equity" && (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            <div className="min-w-0 space-y-5">
              <FundamentalsPanel
                fundamentals={research.fundamentals}
                currency={currency}
                loading={research.loading}
                unavailableReason={
                  "No fundamentals are published for this listing. This is unusual for a large-cap name — try again shortly."
                }
              />
              <EarningsPanel earnings={research.earnings} loading={research.loading} />
              <DriftPanel
                earnings={research.earnings}
                candles={candles}
                loading={research.loading}
              />
            </div>

            <div className="min-w-0 space-y-5">
              <AnalystPanel
                consensus={research.recommendations}
                currentPrice={quote.price}
                currency={currency}
                loading={research.loading}
              />
              <OwnershipPanel
                ownership={research.ownership}
                ratings={research.ratings}
                currency={currency}
                loading={research.loading}
              />
              <PeersPanel peers={research.peers} loading={research.loading} />
              <InsiderPanel slug={slug} currency={currency} />
              <NewsPanel
                slug={slug}
                limit={6}
                title="Recent news"
                subtitle={`Headlines mentioning ${quote.symbol}`}
              />
            </div>
          </div>
        )}

        {/* Strategy testing runs on whatever range the chart is showing, so it
            answers "would this rule have worked on what I'm looking at". */}
        <BacktestPanel
          candles={candles}
          symbol={quote.symbol}
          periodsPerYear={
            RANGE_SPEC[range].interval === "1week"
              ? 52
              : RANGE_SPEC[range].interval === "1month"
                ? 12
                : 252
          }
        />

        {/* Peer comparison needs both a peer list and fundamentals, so it sits
            below the research column that supplies them. */}
        {instrument?.kind === "equity" && research.peers.length > 0 && (
          <PeerValuation
            slug={slug}
            symbol={quote.symbol}
            peers={research.peers}
            subject={research.fundamentals}
            loading={research.loading}
          />
        )}

        {/* Seasonality is free — it runs on the bars already loaded. It only
            says anything on a long range, and tells you so otherwise. */}
        <SeasonalityPanel candles={candles} symbol={quote.symbol} />

        {/* Options exist for US listings on the free data tiers. */}
        {instrument?.region === "US" && <OptionsPanel slug={slug} currency={currency} />}

        {/* Notes sit last: they are the thing you come back to, not the thing
            you arrive for. Available for every instrument, not just equities. */}
        <InstrumentNotes slug={slug} symbol={quote.symbol} />

        {/* ── Profile ──────────────────────────────────────────────────── */}
        {profile && (profile.description || profile.industry) && (
          <Panel flush>
            <PanelHeader title="About" subtitle={profile.industry ?? undefined} />
            <div className="space-y-4 p-4">
              {profile.description && (
                <p className="max-w-[86ch] text-[13px] leading-relaxed text-ivory-60">
                  {profile.description}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
                {profile.ceo && <ProfileItem label="Chief executive" value={profile.ceo} />}
                {profile.employees != null && (
                  <ProfileItem label="Employees" value={formatCompact(profile.employees, currency)} />
                )}
                {profile.country && <ProfileItem label="Country" value={profile.country} />}
                {profile.website && (
                  <ProfileItem
                    label="Website"
                    value={
                      <a
                        href={profile.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-signal underline underline-offset-2"
                      >
                        {profile.website.replace(/^https?:\/\//, "")}
                      </a>
                    }
                  />
                )}
              </dl>
            </div>
          </Panel>
        )}
      </PageBody>

      <AlertComposer
        slug={slug}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        currentPrice={quote.price}
      />
    </>
  );
}

/**
 * Chart height by viewport.
 *
 * A fixed 440px chart occupies most of a phone screen and pushes everything
 * below it out of reach, while on a desktop it is smaller than it should be.
 * Measured rather than done with CSS because the canvas engine needs a real
 * pixel height, not a percentage.
 */
function useResponsiveChartHeight(): number {
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      if (w < 480) return 260;
      if (w < 768) return 320;
      if (w < 1280) return 380;
      return 460;
    };
    const apply = () => setHeight(compute());
    apply();
    window.addEventListener("resize", apply, { passive: true });
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return height;
}

/* ── Research loader ──────────────────────────────────────────────────────── */

interface ResearchState {
  fundamentals: Fundamentals | null;
  recommendations: AnalystConsensus | null;
  earnings: EarningsPoint[];
  peers: string[];
  ownership: Ownership | null;
  ratings: RatingChange[];
  loading: boolean;
}

const EMPTY_RESEARCH: ResearchState = {
  fundamentals: null,
  recommendations: null,
  earnings: [],
  peers: [],
  ownership: null,
  ratings: [],
  loading: false,
};

/**
 * One request for the whole research column.
 *
 * Loaded on the client rather than in the server component deliberately: these
 * panels sit below the fold, and blocking the page's first paint on a
 * fundamentals lookup would trade a visible improvement for an invisible one.
 */
function useResearch(slug: string, enabled: boolean): ResearchState {
  const [state, setState] = useState<ResearchState>({ ...EMPTY_RESEARCH, loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_RESEARCH);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      try {
        const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`research ${res.status}`);

        const body = (await res.json()) as { data: Omit<ResearchState, "loading"> };
        if (cancelled) return;
        setState({ ...EMPTY_RESEARCH, ...body.data, loading: false });
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        // Each panel renders its own "unavailable" state, so an empty result
        // is a complete answer rather than an error to surface.
        setState(EMPTY_RESEARCH);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, enabled]);

  return state;
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-micro text-ivory-40">{label}</p>
      <p className="num-mono mt-1.5 text-[13px] text-ivory">{value}</p>
    </div>
  );
}

function StatRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: number;
  hint?: string;
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-[11px] text-ivory-60", hint && "cursor-help border-b border-dotted border-line-strong")}>
        {label}
      </dt>
      <dd
        className={cn(
          "num-mono shrink-0 text-[12px]",
          tone != null && tone > 0 ? "text-up" : tone != null && tone < 0 ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </dd>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

function CorrelationCard({
  title,
  slug,
  correlation: r,
  beta: b,
  description,
}: {
  title: string;
  slug: string;
  correlation: number;
  beta: number;
  description: string;
}) {
  const strength =
    Math.abs(r) > 0.7 ? "Tightly coupled" : Math.abs(r) > 0.4 ? "Moderately coupled" : "Largely independent";

  return (
    <div className="bg-ink-900 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-micro text-ivory-40">{title}</p>
        <span className="num-mono text-[11px] text-ivory-60">{slug}</span>
      </div>

      <div className="mt-4 flex items-end gap-7">
        <div>
          <p
            className={cn(
              "num-mono text-[30px] leading-none tracking-tight",
              r > 0.4 ? "text-up" : r < -0.4 ? "text-down" : "text-ivory",
            )}
          >
            {r >= 0 ? "+" : ""}
            {r.toFixed(2)}
          </p>
          <p className="label-micro mt-2 text-ivory-40">Correlation</p>
        </div>
        <div>
          <p className="num-mono text-[30px] leading-none tracking-tight text-ivory">
            {b.toFixed(2)}
          </p>
          <p className="label-micro mt-2 text-ivory-40">Beta</p>
        </div>
      </div>

      {/* Correlation on a −1 to +1 axis, so sign is a position not a colour. */}
      <div className="relative mt-5 h-1 w-full rounded-full bg-ink-800">
        <span className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-y-1/2 bg-line-bright" />
        <motion.span
          className={cn("absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full", r >= 0 ? "bg-up" : "bg-down")}
          style={r >= 0 ? { left: "50%" } : { right: "50%" }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(1, Math.abs(r)) * 50}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ivory-40">
        <span className="text-ivory-60">{strength}.</span> {description} A beta of{" "}
        {b.toFixed(2)} implies roughly {(Math.abs(b) * 100).toFixed(0)}% of the index's
        move, {b < 0 ? "in the opposite direction" : "in the same direction"}.
      </p>
    </div>
  );
}

function ProfileItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="label-micro text-ivory-40">{label}</dt>
      <dd className="mt-1.5 truncate text-[12px] text-ivory-80">{value}</dd>
    </div>
  );
}
