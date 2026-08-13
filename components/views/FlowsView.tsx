"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Badge, Button, EmptyState, Panel, PanelHeader, Skeleton, Segmented } from "@/components/ui/primitives";
import { IconRefresh, IconScale } from "@/components/ui/icons";
import { FlowAlertsPanel } from "@/components/market/FlowAlerts";
import { chartPalette } from "@/lib/theme";
import { useThemeVersion } from "@/lib/hooks/theme-context";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Institutional flows.
 *
 * Every trading day, foreign and domestic institutions in India report how
 * much they bought and sold. Those two numbers explain more short-term
 * movement in the Nifty than almost anything else on a terminal — and when
 * they diverge, with foreign money selling into domestic buying, that tension
 * is usually the story of the session.
 */

interface FlowDay {
  date: string;
  label: string;
  fii: { buy: number; sell: number; net: number };
  dii: { buy: number; sell: number; net: number };
}

interface Payload {
  latest: FlowDay | null;
  history: FlowDay[];
  notice?: string;
  asOf: number;
}

type Window = 20 | 60 | 120;

export function FlowsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState<Window>(20);

  useThemeVersion();
  const palette = chartPalette();

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/flows", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Payload);
    } catch {
      /* the empty state covers it */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const series = useMemo(
    () => (data?.history ?? []).slice(-window),
    [data?.history, window],
  );

  const totals = useMemo(() => {
    if (series.length === 0) return null;
    const fii = series.reduce((s, d) => s + d.fii.net, 0);
    const dii = series.reduce((s, d) => s + d.dii.net, 0);
    return { fii, dii, combined: fii + dii, days: series.length };
  }, [series]);

  const latest = data?.latest;

  return (
    <>
      <PageHeader
        eyebrow="India · institutional activity"
        title="Who is actually buying"
        description="Foreign and domestic institutions report their daily buying and selling to the exchange. When the two disagree, that tension usually explains the session better than the index level does."
        meta={
          <>
            {latest && <Badge tone="india">{formatDate(latest.date)}</Badge>}
            {data && <Badge tone="neutral">{data.history.length} sessions stored</Badge>}
            {data?.asOf && (
              <span className="text-[11px] text-ivory-40">Updated {formatRelative(data.asOf)}</span>
            )}
          </>
        }
        actions={
          <Button variant="outline" size="md" icon={<IconRefresh />} onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      <PageBody className="space-y-5">
        {loading && !data ? (
          <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3 bg-ink-900 p-5">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : !latest ? (
          <Panel flush>
            <EmptyState
              icon={<IconScale />}
              title="Flow data is not available right now"
              description={
                data?.notice ??
                "The exchange publishes these figures after each session closes. Check back a little later."
              }
              action={
                <Button variant="secondary" size="md" onClick={load}>
                  Try again
                </Button>
              }
            />
          </Panel>
        ) : (
          <>
            {/* Latest session */}
            <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
              <FlowCard
                title="Foreign institutions"
                subtitle="FII / FPI"
                net={latest.fii.net}
                buy={latest.fii.buy}
                sell={latest.fii.sell}
                accent="india"
              />
              <FlowCard
                title="Domestic institutions"
                subtitle="Mutual funds, insurers, banks"
                net={latest.dii.net}
                buy={latest.dii.buy}
                sell={latest.dii.sell}
                accent="usa"
              />
              <div className="bg-ink-900 p-5">
                <p className="label-micro text-ivory-40">Combined</p>
                <p
                  className={cn(
                    "num-mono mt-3 text-[26px] leading-none tracking-tight",
                    latest.fii.net + latest.dii.net >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {formatCrore(latest.fii.net + latest.dii.net)}
                </p>
                <p className="mt-4 text-[11px] leading-relaxed text-ivory-40">
                  {readSession(latest)}
                </p>
              </div>
            </div>

            {/* History */}
            <Panel flush>
              <PanelHeader
                title="Daily net flows"
                subtitle="Bars above the line are net buying, below is net selling"
                action={
                  <Segmented
                    value={String(window)}
                    onChange={(v) => setWindow(Number(v) as Window)}
                    layoutIdSuffix="flow-window"
                    options={[
                      { value: "20", label: "20d" },
                      { value: "60", label: "60d" },
                      { value: "120", label: "120d" },
                    ]}
                  />
                }
              />

              {series.length < 2 ? (
                <EmptyState
                  title="History is still building"
                  description="Meridian records each session's figures as it sees them, because the exchange only publishes the latest day. Come back tomorrow and the chart starts filling in."
                />
              ) : (
                <div className="p-3">
                  <FlowChart series={series} palette={palette} />

                  {totals && (
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
                      <Stat label={`FII, ${totals.days}d`} value={formatCrore(totals.fii)} tone={totals.fii} />
                      <Stat label={`DII, ${totals.days}d`} value={formatCrore(totals.dii)} tone={totals.dii} />
                      <Stat label="Combined" value={formatCrore(totals.combined)} tone={totals.combined} />
                      <Stat
                        label="Sessions"
                        value={String(totals.days)}
                      />
                    </dl>
                  )}
                </div>
              )}
            </Panel>

            <FlowAlertsPanel latest={latest} />

            <Panel>
              <p className="text-[12px] leading-relaxed text-ivory-60">
                Figures are in crore rupees and cover the cash segment. Foreign flows tend to
                follow the dollar and global risk appetite; domestic flows are driven largely
                by monthly retail contributions into mutual funds, which makes them steadier.
                A market where foreign money is selling and domestic money is absorbing it can
                stay flat for a long time.
              </p>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function FlowCard({
  title,
  subtitle,
  net,
  buy,
  sell,
  accent,
}: {
  title: string;
  subtitle: string;
  net: number;
  buy: number;
  sell: number;
  accent: "india" | "usa";
}) {
  const total = buy + sell;
  const buyShare = total > 0 ? (buy / total) * 100 : 50;

  return (
    <div className="bg-ink-900 p-5">
      <p className="label-micro text-ivory-40">{title}</p>
      <p className="label-micro-tight mt-1 text-ivory-25">{subtitle}</p>

      <p
        className={cn(
          "num-mono mt-3 text-[26px] leading-none tracking-tight",
          net >= 0 ? "text-up" : "text-down",
        )}
      >
        {formatCrore(net)}
      </p>

      {/* Gross buying against gross selling — a large net on tiny gross is a
          different market from a large net on huge gross. */}
      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-ink-800">
        <motion.span
          className="bg-up"
          initial={{ width: 0 }}
          animate={{ width: `${buyShare}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
        <span className="flex-1 bg-down" />
      </div>
      <div className="mt-2 flex justify-between">
        <span className="num-mono text-[10px] text-up">bought {formatCrore(buy, false)}</span>
        <span className="num-mono text-[10px] text-down">sold {formatCrore(sell, false)}</span>
      </div>

      <span
        className="mt-3 block h-px w-8"
        style={{ backgroundColor: accent === "india" ? "#f0a63c" : "#7ba7f0" }}
      />
    </div>
  );
}

function FlowChart({
  series,
  palette,
}: {
  series: FlowDay[];
  palette: ReturnType<typeof chartPalette>;
}) {
  const W = 900;
  const H = 220;
  const PAD = { top: 14, right: 8, bottom: 18, left: 8 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const extent = Math.max(
    ...series.map((d) => Math.max(Math.abs(d.fii.net), Math.abs(d.dii.net))),
    1,
  );

  const zeroY = PAD.top + plotH / 2;
  const scale = (v: number) => (v / extent) * (plotH / 2) * 0.92;
  const slot = plotW / series.length;
  const barW = Math.max(1.5, slot * 0.34);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[220px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily net institutional flows"
    >
      <line
        x1={PAD.left}
        x2={PAD.left + plotW}
        y1={zeroY}
        y2={zeroY}
        stroke={palette.axis}
        strokeWidth={1}
      />

      {series.map((d, i) => {
        const x = PAD.left + i * slot + slot / 2;
        const fiiH = scale(d.fii.net);
        const diiH = scale(d.dii.net);

        return (
          <g key={d.date}>
            {/* Foreign on the left of each slot, domestic on the right. */}
            <motion.rect
              x={x - barW - 1}
              width={barW}
              y={fiiH >= 0 ? zeroY - fiiH : zeroY}
              initial={{ height: 0 }}
              animate={{ height: Math.max(1, Math.abs(fiiH)) }}
              transition={{ duration: 0.5, delay: Math.min(i * 0.008, 0.3) }}
              fill="#f0a63c"
              opacity={0.9}
            />
            <motion.rect
              x={x + 1}
              width={barW}
              y={diiH >= 0 ? zeroY - diiH : zeroY}
              initial={{ height: 0 }}
              animate={{ height: Math.max(1, Math.abs(diiH)) }}
              transition={{ duration: 0.5, delay: Math.min(i * 0.008, 0.3) }}
              fill="#7ba7f0"
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <dt className="label-micro text-ivory-40">{label}</dt>
      <dd
        className={cn(
          "num-mono mt-1.5 text-[13px]",
          tone == null ? "text-ivory" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Crore rupees, the unit these figures are always quoted in. */
function formatCrore(value: number, signed = true): string {
  const sign = signed && value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L Cr`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function readSession(day: FlowDay): string {
  const f = day.fii.net;
  const d = day.dii.net;

  if (f < 0 && d > 0) {
    return Math.abs(f) > d
      ? "Foreign money sold more than domestic institutions absorbed — net supply into the market."
      : "Foreign selling was fully absorbed by domestic buying, which is what has kept dips shallow.";
  }
  if (f > 0 && d < 0) {
    return "Foreign buying met domestic profit-taking — often seen after a strong run.";
  }
  if (f > 0 && d > 0) return "Both foreign and domestic institutions were net buyers. Broad-based demand.";
  if (f < 0 && d < 0) return "Both were net sellers — the clearest risk-off configuration there is.";
  return "Institutional activity was roughly balanced.";
}
