"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "motion/react";

import type {
  AnalystConsensus,
  EarningsPoint,
  Fundamentals,
} from "@/lib/providers/types";
import type { Currency } from "@/lib/format";
import { formatCompactMoney, formatDate, formatPercent, formatPrice } from "@/lib/format";
import { Badge, EmptyState, Panel, PanelHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { findBySymbol } from "@/lib/market/universe";
import { cn } from "@/lib/utils";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";

/** Blend two colours in sRGB. Enough for a five-stop ramp. */
function mix(a: string, b: string, t: number): string {
  const parse = (c: string): [number, number, number] => {
    const hex = c.trim().replace("#", "");
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`;
}

/**
 * The research column: fundamentals, analyst consensus, earnings history and
 * peers.
 *
 * These are the panels that separate a price viewer from a terminal. They are
 * also the ones most likely to be unavailable — free tiers cover US listings
 * and little else — so each states plainly what it does not have rather than
 * rendering an empty shell.
 */

/* ── Fundamentals ─────────────────────────────────────────────────────────── */

interface MetricSpec {
  key: keyof Fundamentals;
  label: string;
  hint: string;
  format: "ratio" | "percent" | "money" | "count";
  /** Higher is better, lower is better, or neither. */
  polarity: 1 | -1 | 0;
}

const VALUATION: MetricSpec[] = [
  { key: "peRatio", label: "P/E (TTM)", hint: "Price divided by trailing twelve-month earnings per share. Lower is cheaper, but a low multiple often prices in a problem.", format: "ratio", polarity: 0 },
  { key: "pegRatio", label: "PEG", hint: "P/E divided by earnings growth. Below 1 traditionally suggests growth is not fully priced in.", format: "ratio", polarity: 0 },
  { key: "priceToBook", label: "P/B", hint: "Price relative to book value. Most meaningful for banks and asset-heavy businesses.", format: "ratio", polarity: 0 },
  { key: "priceToSales", label: "P/S", hint: "Price relative to revenue. Used where earnings are negative or volatile.", format: "ratio", polarity: 0 },
  { key: "eps", label: "EPS (TTM)", hint: "Trailing twelve-month earnings per share.", format: "ratio", polarity: 1 },
  { key: "dividendYield", label: "Dividend yield", hint: "Indicated annual dividend as a percentage of price.", format: "percent", polarity: 1 },
];

const PROFITABILITY: MetricSpec[] = [
  { key: "grossMargin", label: "Gross margin", hint: "Revenue less cost of goods, as a share of revenue. Pricing power.", format: "percent", polarity: 1 },
  { key: "operatingMargin", label: "Operating margin", hint: "Operating profit as a share of revenue. Efficiency of the core business.", format: "percent", polarity: 1 },
  { key: "netMargin", label: "Net margin", hint: "Bottom-line profit as a share of revenue.", format: "percent", polarity: 1 },
  { key: "roe", label: "Return on equity", hint: "Profit generated per unit of shareholder capital. Flattered by leverage.", format: "percent", polarity: 1 },
  { key: "roa", label: "Return on assets", hint: "Profit per unit of total assets. Harder to flatter than ROE.", format: "percent", polarity: 1 },
];

const BALANCE: MetricSpec[] = [
  { key: "debtToEquity", label: "Debt / equity", hint: "Total debt relative to shareholder equity. Higher means more leverage and more fragility.", format: "ratio", polarity: -1 },
  { key: "currentRatio", label: "Current ratio", hint: "Current assets over current liabilities. Below 1 means short-term obligations exceed liquid assets.", format: "ratio", polarity: 1 },
  { key: "beta", label: "Beta", hint: "Sensitivity to the broad market. Above 1 amplifies index moves.", format: "ratio", polarity: 0 },
  { key: "sharesOutstanding", label: "Shares outstanding", hint: "Total shares issued. A falling count means buybacks.", format: "count", polarity: 0 },
];

export function FundamentalsPanel({
  fundamentals,
  currency,
  loading,
  unavailableReason,
}: {
  fundamentals: Fundamentals | null;
  currency: Currency;
  loading: boolean;
  unavailableReason?: string;
}) {
  if (loading) {
    return (
      <Panel flush>
        <PanelHeader title="Fundamentals" subtitle="Trailing twelve months" />
        <div className="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  if (!fundamentals) {
    return (
      <Panel flush>
        <PanelHeader title="Fundamentals" subtitle="Trailing twelve months" />
        <EmptyState
          title="Not available for this listing"
          description={
            unavailableReason ??
            "Fundamentals come from Financial Modeling Prep and Finnhub, whose free tiers cover US listings. Add an API key, or open a US-listed instrument."
          }
        />
      </Panel>
    );
  }

  return (
    <Panel flush>
      <PanelHeader
        title="Fundamentals"
        subtitle={
          fundamentals.asOf ? `Trailing twelve months · as of ${formatDate(fundamentals.asOf)}` : "Trailing twelve months"
        }
        action={<Badge tone="neutral">{fundamentals.provider}</Badge>}
      />

      <div className="divide-y divide-line/60">
        <MetricGroup title="Valuation" metrics={VALUATION} data={fundamentals} currency={currency} />
        <MetricGroup title="Profitability" metrics={PROFITABILITY} data={fundamentals} currency={currency} />
        <MetricGroup title="Balance sheet" metrics={BALANCE} data={fundamentals} currency={currency} />
      </div>
    </Panel>
  );
}

function MetricGroup({
  title,
  metrics,
  data,
  currency,
}: {
  title: string;
  metrics: MetricSpec[];
  data: Fundamentals;
  currency: Currency;
}) {
  const present = metrics.filter((m) => data[m.key] != null);
  if (present.length === 0) return null;

  return (
    <div className="p-4">
      <p className="label-micro mb-3 text-ivory-40">{title}</p>
      <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
        {present.map((spec, i) => (
          <motion.div
            key={String(spec.key)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: i * 0.025 }}
            className="flex items-baseline justify-between gap-4"
          >
            <Tooltip content={spec.hint}>
              <dt className="cursor-help border-b border-dotted border-line-strong text-[11px] text-ivory-60">
                {spec.label}
              </dt>
            </Tooltip>
            <dd className={cn("num-mono shrink-0 text-[12px]", toneFor(spec, data[spec.key]))}>
              {formatMetric(spec, data[spec.key], currency)}
            </dd>
          </motion.div>
        ))}
      </dl>
    </div>
  );
}

function formatMetric(spec: MetricSpec, raw: Fundamentals[keyof Fundamentals], currency: Currency): string {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "—";
  switch (spec.format) {
    case "percent":
      return `${raw.toFixed(1)}%`;
    case "money":
      return formatCompactMoney(raw, currency);
    case "count":
      return formatCompactMoney(raw, currency).replace(/^[₹$]/, "");
    default:
      return raw.toFixed(2);
  }
}

/**
 * Colour only where direction is genuinely unambiguous. A low P/E is not
 * "good" — it is cheap, which is sometimes a bargain and sometimes a warning —
 * so valuation multiples stay neutral while margins and leverage do not.
 */
function toneFor(spec: MetricSpec, raw: Fundamentals[keyof Fundamentals]): string {
  if (spec.polarity === 0 || typeof raw !== "number") return "text-ivory";
  if (spec.key === "debtToEquity") return raw > 2 ? "text-down" : raw < 1 ? "text-up" : "text-ivory";
  if (spec.key === "currentRatio") return raw < 1 ? "text-down" : raw > 1.5 ? "text-up" : "text-ivory";
  return raw > 0 ? "text-up" : "text-down";
}

/* ── Analyst consensus ────────────────────────────────────────────────────── */

const RATING_BANDS: { max: number; label: string; tone: string }[] = [
  { max: 1.5, label: "Strong buy", tone: "text-up" },
  { max: 2.5, label: "Buy", tone: "text-up" },
  { max: 3.5, label: "Hold", tone: "text-ivory" },
  { max: 4.5, label: "Sell", tone: "text-down" },
  { max: 5.1, label: "Strong sell", tone: "text-down" },
];

export function AnalystPanel({
  consensus,
  currentPrice,
  currency,
  loading,
}: {
  consensus: AnalystConsensus | null;
  currentPrice: number;
  currency: Currency;
  loading: boolean;
}) {
  const band = useMemo(
    () => (consensus ? RATING_BANDS.find((b) => consensus.score < b.max) ?? RATING_BANDS[2]! : null),
    [consensus],
  );

  useThemeVersion();
  const palette = chartPalette();

  if (loading) {
    return (
      <Panel flush>
        <PanelHeader title="Analyst consensus" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </Panel>
    );
  }

  if (!consensus || !band) {
    return (
      <Panel flush>
        <PanelHeader title="Analyst consensus" />
        <EmptyState
          title="No coverage available"
          description="Analyst ratings come from Finnhub and are published for US listings with sell-side coverage."
        />
      </Panel>
    );
  }

  // A five-stop diverging ramp anchored on the theme's own up/down tokens, so
  // the distribution stays legible on paper as well as on ink.
  const buckets = [
    { label: "Strong buy", count: consensus.strongBuy, color: palette.up },
    { label: "Buy", count: consensus.buy, color: mix(palette.up, palette.textDim, 0.35) },
    { label: "Hold", count: consensus.hold, color: palette.textDim },
    { label: "Sell", count: consensus.sell, color: mix(palette.down, palette.textDim, 0.35) },
    { label: "Strong sell", count: consensus.strongSell, color: palette.down },
  ];

  const upside =
    consensus.targetMean != null && currentPrice > 0
      ? ((consensus.targetMean - currentPrice) / currentPrice) * 100
      : null;

  return (
    <Panel flush>
      <PanelHeader
        title="Analyst consensus"
        subtitle={consensus.period ? `${consensus.total} analysts · ${consensus.period}` : `${consensus.total} analysts`}
      />

      <div className="p-4">
        <p className={cn("text-[24px] leading-none tracking-tight", band.tone)}>{band.label}</p>
        <p className="num-mono mt-2 text-[11px] text-ivory-40">
          Mean rating {consensus.score.toFixed(2)} on a 1–5 scale
        </p>

        {/* Distribution. Proportional widths make a lopsided book obvious. */}
        <div className="mt-4 flex h-2 gap-px overflow-hidden rounded-full bg-ink-800">
          {buckets.map((b) => (
            <motion.span
              key={b.label}
              initial={{ width: 0 }}
              animate={{ width: `${(b.count / consensus.total) * 100}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ backgroundColor: b.color }}
              title={`${b.label}: ${b.count}`}
            />
          ))}
        </div>

        <dl className="mt-4 space-y-2">
          {buckets
            .filter((b) => b.count > 0)
            .map((b) => (
              <div key={b.label} className="flex items-baseline justify-between gap-3">
                <dt className="flex items-center gap-2 text-[11px] text-ivory-60">
                  <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: b.color }} />
                  {b.label}
                </dt>
                <dd className="num-mono text-[11px] text-ivory">{b.count}</dd>
              </div>
            ))}
        </dl>

        {(consensus.targetMean != null || consensus.targetHigh != null) && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="label-micro mb-3 text-ivory-40">Price target</p>

            {consensus.targetLow != null && consensus.targetHigh != null && (
              <TargetBar
                low={consensus.targetLow}
                high={consensus.targetHigh}
                mean={consensus.targetMean}
                current={currentPrice}
                currency={currency}
              />
            )}

            {upside != null && (
              <p className="mt-3.5 text-[11px] leading-relaxed text-ivory-40">
                Mean target of{" "}
                <span className="num-mono text-ivory">
                  {formatPrice(consensus.targetMean!, currency)}
                </span>{" "}
                implies{" "}
                <span className={cn("num-mono", upside >= 0 ? "text-up" : "text-down")}>
                  {formatPercent(upside)}
                </span>{" "}
                from here. Targets are a poll of sell-side opinion, not a forecast.
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * The target range with the live price marked on it. Seeing spot sitting above
 * the high target says more than any single number.
 */
function TargetBar({
  low,
  high,
  mean,
  current,
  currency,
}: {
  low: number;
  high: number;
  mean: number | null;
  current: number;
  currency: Currency;
}) {
  // Include the live price in the extent so a stock trading outside the
  // analyst range still renders inside the track.
  const min = Math.min(low, current) * 0.98;
  const max = Math.max(high, current) * 1.02;
  const pos = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div>
      <div className="relative h-1.5 w-full rounded-full bg-ink-800">
        <motion.span
          className="absolute inset-y-0 rounded-full bg-usa/35"
          initial={{ width: 0 }}
          animate={{ left: `${pos(low)}%`, width: `${pos(high) - pos(low)}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
        {mean != null && (
          <span
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-usa"
            style={{ left: `${pos(mean)}%` }}
            title={`Mean target ${formatPrice(mean, currency)}`}
          />
        )}
        <motion.span
          className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-signal"
          initial={{ opacity: 0 }}
          animate={{ left: `${pos(current)}%`, opacity: 1 }}
          transition={{ duration: 0.5 }}
          title={`Now ${formatPrice(current, currency)}`}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="num-mono text-[10px] text-ivory-40">{formatPrice(low, currency)}</span>
        <span className="label-micro-tight text-signal">now</span>
        <span className="num-mono text-[10px] text-ivory-40">{formatPrice(high, currency)}</span>
      </div>
    </div>
  );
}

/* ── Earnings ─────────────────────────────────────────────────────────────── */

export function EarningsPanel({
  earnings,
  loading,
}: {
  earnings: EarningsPoint[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <Panel flush>
        <PanelHeader title="Earnings history" />
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    );
  }

  if (earnings.length === 0) {
    return (
      <Panel flush>
        <PanelHeader title="Earnings history" />
        <EmptyState
          title="No earnings history"
          description="Reported EPS against estimate is available for US listings via Finnhub and FMP."
        />
      </Panel>
    );
  }

  const maxSurprise = Math.max(10, ...earnings.map((e) => Math.abs(e.surprisePercent ?? 0)));

  return (
    <Panel flush>
      <PanelHeader title="Earnings history" subtitle="Reported EPS against consensus estimate" />

      <ul className="divide-y divide-line/60">
        {earnings.map((e, i) => {
          const surprise = e.surprisePercent;
          const beat = surprise != null && surprise >= 0;

          return (
            <motion.li
              key={e.period}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              className="flex items-center gap-4 px-4 py-2.5"
            >
              <span className="num-mono w-[76px] shrink-0 text-[11px] text-ivory-60">
                {e.period}
              </span>

              <span className="num-mono w-[64px] shrink-0 text-right text-[12px] text-ivory">
                {e.epsActual != null ? e.epsActual.toFixed(2) : "—"}
              </span>
              <span className="num-mono hidden w-[64px] shrink-0 text-right text-[11px] text-ivory-40 sm:block">
                est {e.epsEstimate != null ? e.epsEstimate.toFixed(2) : "—"}
              </span>

              {/* Surprise, centred on zero so beats and misses read as sides. */}
              <span className="relative hidden h-3 flex-1 sm:block">
                <span className="absolute left-1/2 top-0 h-full w-px bg-line-strong" />
                {surprise != null && (
                  <motion.span
                    className={cn(
                      "absolute top-1/2 h-[6px] -translate-y-1/2 rounded-[1px]",
                      beat ? "bg-up/75" : "bg-down/75",
                    )}
                    style={beat ? { left: "50%" } : { right: "50%" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(Math.min(Math.abs(surprise), maxSurprise) / maxSurprise) * 50}%` }}
                    transition={{ duration: 0.6, delay: i * 0.04 }}
                  />
                )}
              </span>

              <span
                className={cn(
                  "num-mono w-[62px] shrink-0 text-right text-[11px]",
                  surprise == null ? "text-ivory-40" : beat ? "text-up" : "text-down",
                )}
              >
                {surprise != null ? formatPercent(surprise, { decimals: 1 }) : "—"}
              </span>
            </motion.li>
          );
        })}
      </ul>

      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ivory-40">
        A consistent run of beats often means guidance is being managed, not that the
        business is accelerating.
      </p>
    </Panel>
  );
}

/* ── Peers ────────────────────────────────────────────────────────────────── */

export function PeersPanel({ peers, loading }: { peers: string[]; loading: boolean }) {
  // Peers arrive as bare tickers; only those in our universe can be linked.
  const resolved = useMemo(
    () =>
      peers
        .map((symbol) => ({ symbol, instrument: findBySymbol(symbol) }))
        .filter((p) => p.instrument),
    [peers],
  );

  if (loading) {
    return (
      <Panel>
        <p className="label-micro mb-3 text-ivory-40">Peers</p>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16" />
          ))}
        </div>
      </Panel>
    );
  }

  if (resolved.length === 0) return null;

  return (
    <Panel>
      <p className="label-micro mb-3 text-ivory-40">Peers</p>
      <div className="flex flex-wrap gap-1.5">
        {resolved.map(({ symbol, instrument }) => (
          <Link
            key={symbol}
            href={`/stock/${encodeURIComponent(instrument!.slug)}`}
            className="num-mono rounded-sm border border-line px-2.5 py-1.5 text-[11px] text-ivory-60 transition-colors hover:border-line-bright hover:text-ivory"
          >
            {symbol}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ivory-40">
        Comparable companies by sector and size. Open any of them, or add several on the{" "}
        <Link href="/compare" className="text-ivory-60 underline underline-offset-2">
          compare
        </Link>{" "}
        page to read them on one axis.
      </p>
    </Panel>
  );
}
