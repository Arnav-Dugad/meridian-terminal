"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Panel,
  PanelHeader,
  Segmented,
  Tooltip,
} from "@/components/ui/primitives";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { IconBriefcase, IconClose, IconPlus, IconSearch, IconTrash } from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { findBySlug, searchUniverse, SECTOR_HUE } from "@/lib/market/universe";
import { concentration, valuePortfolio } from "@/lib/analytics/portfolio";
import type { Currency } from "@/lib/format";
import { formatCompactMoney, formatPercent, formatPrice, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FxRate } from "@/lib/twelvedata/types";

export function PortfolioView() {
  const { positions, preferences, setPreference, addPosition, removePosition, mode, ready } = usePersonal();
  const [composerOpen, setComposerOpen] = useState(false);
  const [fx, setFx] = useState<FxRate | null>(null);

  const slugs = useMemo(() => Array.from(new Set(positions.map((p) => p.slug))), [positions]);
  const { map, source } = useQuotes(slugs);

  // One FX read, refreshed on a slow cadence — the rate moves in basis points
  // over minutes, and it is the denominator of every figure on this page.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/fx?pair=USD/INR");
        if (!res.ok) return;
        const body = (await res.json()) as { data: FxRate };
        if (!cancelled) setFx(body.data);
      } catch {
        /* keep the last known rate */
      }
    };
    void load();
    const timer = setInterval(load, 300_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const base = preferences.baseCurrency;
  const rate = fx?.rate ?? 88;

  const summary = useMemo(
    () => valuePortfolio(positions, map, base, rate),
    [positions, map, base, rate],
  );

  const hhi = useMemo(
    () => concentration(summary.positions.map((p) => p.weight)),
    [summary.positions],
  );

  const money = (v: number) => formatPrice(v, base);

  if (ready && positions.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Portfolio"
          title="Your book"
          description="Hold rupee and dollar positions in one place. Totals convert at the live rate, and every figure is marked to the last print."
          actions={
            <Button variant="primary" size="md" icon={<IconPlus />} onClick={() => setComposerOpen(true)}>
              Add position
            </Button>
          }
        />
        <PageBody>
          <Panel flush>
            <EmptyState
              icon={<IconBriefcase />}
              title="No positions yet"
              description="Add what you hold — quantity and average price — and Meridian marks it to market, splits the exposure by region and sector, and shows what is moving the book today."
              action={
                <Button variant="primary" size="md" icon={<IconPlus />} onClick={() => setComposerOpen(true)}>
                  Add your first position
                </Button>
              }
            />
          </Panel>
        </PageBody>
        <PositionComposer open={composerOpen} onClose={() => setComposerOpen(false)} onAdd={addPosition} quotes={map} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Your book"
        description={`Marked to the last print, totalled in ${base === "INR" ? "rupees" : "dollars"} at ${rate.toFixed(3)} USD/INR.`}
        meta={
          <>
            <DataSourceNotice source={source} />
            <Badge tone="neutral">{positions.length} positions</Badge>
            <Badge tone={mode === "cloud" ? "up" : "signal"}>
              {mode === "cloud" ? "Cloud sync" : "This device"}
            </Badge>
            {summary.pricedCount < positions.length && (
              <Badge tone="signal">{positions.length - summary.pricedCount} unpriced</Badge>
            )}
          </>
        }
        actions={
          <>
            <Segmented
              value={base}
              onChange={(c) => setPreference("baseCurrency", c as Currency)}
              layoutIdSuffix="portfolio-base"
              options={[
                { value: "INR", label: "₹ INR" },
                { value: "USD", label: "$ USD" },
              ]}
            />
            <Button variant="primary" size="md" icon={<IconPlus />} onClick={() => setComposerOpen(true)}>
              Add position
            </Button>
          </>
        }
      />

      <PageBody className="space-y-5">
        {/* Headline figures */}
        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <HeadlineCell label="Market value" value={money(summary.value)} sub={`Cost ${money(summary.cost)}`} />
          <HeadlineCell
            label="Total P&L"
            value={money(summary.pnl)}
            sub={formatPercent(summary.pnlPercent)}
            tone={summary.pnl}
            animate
          />
          <HeadlineCell
            label="Today"
            value={money(summary.dayPnl)}
            sub={formatPercent(summary.dayPnlPercent)}
            tone={summary.dayPnl}
            animate
          />
          <HeadlineCell
            label="Currency exposure"
            value={`${(summary.fxExposure * 100).toFixed(0)}%`}
            sub={`Not in ${base}`}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          {/* Positions */}
          <Panel flush className="min-w-0">
            <PanelHeader
              title="Positions"
              subtitle="Marked to the last print, in the instrument's own currency"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    {["Instrument", "Qty", "Avg cost", "Last", "Value", "P&L", "Today", "Weight", ""].map(
                      (h, i) => (
                        <th
                          key={h || i}
                          className={cn(
                            "label-micro px-3 py-2.5 font-medium text-ivory-40",
                            i === 0 ? "text-left" : i === 8 ? "w-9" : "text-right",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {summary.positions
                      .slice()
                      .sort((a, b) => b.value - a.value)
                      .map((row) => {
                        const inst = findBySlug(row.position.slug);
                        return (
                          <motion.tr
                            key={row.position.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, height: 0 }}
                            className="group border-b border-line/60 transition-colors hover:bg-ink-850"
                          >
                            <td className="px-3 py-2.5">
                              <Link
                                href={`/stock/${encodeURIComponent(row.position.slug)}`}
                                className="flex items-center gap-2.5"
                              >
                                <span
                                  className="h-6 w-[2px] shrink-0 rounded-full opacity-70"
                                  style={{ backgroundColor: row.region === "IN" ? "#f0a63c" : "#7ba7f0" }}
                                />
                                <span className="min-w-0">
                                  <span className="num-mono block text-[12px] text-ivory">
                                    {row.position.symbol}
                                  </span>
                                  <span className="block max-w-[22ch] truncate text-[11px] text-ivory-40">
                                    {inst?.name ?? row.position.name}
                                  </span>
                                </span>
                              </Link>
                            </td>
                            <td className="num-mono px-3 py-2.5 text-right text-[12px] text-ivory-80">
                              {row.position.quantity}
                            </td>
                            <td className="num-mono px-3 py-2.5 text-right text-[12px] text-ivory-60">
                              {formatPrice(row.position.avgPrice, row.position.currency)}
                            </td>
                            <td className="num-mono px-3 py-2.5 text-right text-[12px] text-ivory">
                              {row.quote ? (
                                <AnimatedNumber
                                  value={row.quote.price}
                                  format={(v) => formatPrice(v, row.position.currency)}
                                  flash
                                />
                              ) : (
                                <span className="text-ivory-40">—</span>
                              )}
                            </td>
                            <td className="num-mono px-3 py-2.5 text-right text-[12px] text-ivory">
                              {money(row.value)}
                            </td>
                            <td
                              className={cn(
                                "num-mono px-3 py-2.5 text-right text-[12px]",
                                row.pnl >= 0 ? "text-up" : "text-down",
                              )}
                            >
                              {money(row.pnl)}
                              <span className="ml-1.5 text-[10px] opacity-70">
                                {formatPercent(row.pnlPercent)}
                              </span>
                            </td>
                            <td
                              className={cn(
                                "num-mono px-3 py-2.5 text-right text-[12px]",
                                row.dayPnl >= 0 ? "text-up" : "text-down",
                              )}
                            >
                              {money(row.dayPnl)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="flex items-center justify-end gap-2">
                                <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-ink-700 sm:block">
                                  <span
                                    className="block h-full rounded-full bg-signal/70"
                                    style={{ width: `${row.weight * 100}%` }}
                                  />
                                </span>
                                <span className="num-mono text-[11px] text-ivory-60">
                                  {(row.weight * 100).toFixed(1)}%
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                onClick={() => removePosition(row.position.id)}
                                aria-label={`Remove ${row.position.symbol} position`}
                                className="rounded-sm p-1.5 text-ivory-25 opacity-0 transition-all hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Analytics */}
          <div className="space-y-5">
            <Panel>
              <p className="label-micro mb-4 text-ivory-40">Allocation by market</p>
              <div className="flex h-2 gap-px overflow-hidden rounded-full bg-ink-800">
                {summary.byRegion.map((r) => (
                  <motion.span
                    key={r.region}
                    initial={{ width: 0 }}
                    animate={{ width: `${r.share * 100}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    style={{ backgroundColor: r.region === "IN" ? "#f0a63c" : "#7ba7f0" }}
                  />
                ))}
              </div>
              <dl className="mt-4 space-y-2.5">
                {summary.byRegion.map((r) => (
                  <div key={r.region} className="flex items-baseline justify-between gap-3">
                    <dt className="flex items-center gap-2 text-[11px] text-ivory-60">
                      <span
                        className="h-2 w-2 rounded-[1px]"
                        style={{ backgroundColor: r.region === "IN" ? "#f0a63c" : "#7ba7f0" }}
                      />
                      {r.region === "IN" ? "India" : "United States"}
                    </dt>
                    <dd className="num-mono text-[11px] text-ivory">
                      {(r.share * 100).toFixed(1)}%
                      <span className="ml-2 text-ivory-40">{formatCompactMoney(r.value, base)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel>
              <p className="label-micro mb-4 text-ivory-40">Allocation by sector</p>
              <div className="flex h-2 gap-px overflow-hidden rounded-full bg-ink-800">
                {summary.bySector.map((s) => (
                  <motion.span
                    key={s.sector}
                    initial={{ width: 0 }}
                    animate={{ width: `${s.share * 100}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    style={{ backgroundColor: SECTOR_HUE[s.sector] }}
                  />
                ))}
              </div>
              <dl className="mt-4 space-y-2">
                {summary.bySector.slice(0, 5).map((s) => (
                  <div key={s.sector} className="flex items-baseline justify-between gap-3">
                    <dt className="flex min-w-0 items-center gap-2 text-[11px] text-ivory-60">
                      <span
                        className="h-2 w-2 shrink-0 rounded-[1px]"
                        style={{ backgroundColor: SECTOR_HUE[s.sector] }}
                      />
                      <span className="truncate">{s.sector}</span>
                    </dt>
                    <dd className="num-mono shrink-0 text-[11px] text-ivory">
                      {(s.share * 100).toFixed(1)}%
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <Panel>
              <p className="label-micro mb-4 text-ivory-40">Book quality</p>
              <dl className="space-y-3">
                <QualityRow
                  label="Concentration"
                  value={`${(hhi * 100).toFixed(0)}%`}
                  hint="Herfindahl index, normalised. 0% is evenly spread across your positions; 100% is a single name."
                  tone={hhi > 0.5 ? -1 : hhi > 0.3 ? 0 : 1}
                />
                <QualityRow
                  label="Positions"
                  value={String(positions.length)}
                  hint="More names dilutes single-stock risk, but only if they are not all in one sector."
                  tone={positions.length >= 8 ? 1 : positions.length >= 4 ? 0 : -1}
                />
                <QualityRow
                  label="FX exposure"
                  value={`${(summary.fxExposure * 100).toFixed(0)}%`}
                  hint={`Share of the book priced outside ${base}. This portion moves with USD/INR as well as with its own market.`}
                  tone={0}
                />
              </dl>

              {(summary.contributors.length > 0 || summary.detractors.length > 0) && (
                <div className="mt-5 space-y-2.5 border-t border-line pt-4">
                  <p className="label-micro text-ivory-40">Moving the book today</p>
                  {summary.contributors.map((c) => (
                    <MoverRow key={c.position.id} symbol={c.position.symbol} value={money(c.dayPnl)} positive />
                  ))}
                  {summary.detractors.map((d) => (
                    <MoverRow key={d.position.id} symbol={d.position.symbol} value={money(d.dayPnl)} positive={false} />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        <p className="max-w-[80ch] text-[11px] leading-relaxed text-ivory-40">
          Positions are held in their own currency and converted at read time, so the
          totals above move with USD/INR as well as with the underlying prices. Cost basis
          is whatever you entered; there is no brokerage, tax or dividend accounting here.
        </p>
      </PageBody>

      <PositionComposer open={composerOpen} onClose={() => setComposerOpen(false)} onAdd={addPosition} quotes={map} />
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function HeadlineCell({
  label,
  value,
  sub,
  tone,
  animate,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: number;
  animate?: boolean;
}) {
  const toneClass = tone == null ? "text-ivory" : tone > 0 ? "text-up" : tone < 0 ? "text-down" : "text-ivory";
  return (
    <div className="bg-ink-900 p-4">
      <p className="label-micro text-ivory-40">{label}</p>
      <p className={cn("num-mono mt-3 text-[22px] leading-none tracking-tight", toneClass)}>
        {animate ? <span>{value}</span> : value}
      </p>
      {sub && <p className={cn("num-mono mt-2 text-[11px]", tone == null ? "text-ivory-40" : toneClass)}>{sub}</p>}
    </div>
  );
}

function QualityRow({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: number;
}) {
  return (
    <Tooltip content={hint}>
      <div className="flex w-full items-baseline justify-between gap-3">
        <dt className="cursor-help border-b border-dotted border-line-strong text-[11px] text-ivory-60">
          {label}
        </dt>
        <dd
          className={cn(
            "num-mono shrink-0 text-[12px]",
            tone > 0 ? "text-up" : tone < 0 ? "text-signal" : "text-ivory",
          )}
        >
          {value}
        </dd>
      </div>
    </Tooltip>
  );
}

function MoverRow({ symbol, value, positive }: { symbol: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="num-mono text-[11px] text-ivory-60">{symbol}</span>
      <span className={cn("num-mono text-[11px]", positive ? "text-up" : "text-down")}>{value}</span>
    </div>
  );
}

/* ── Composer ─────────────────────────────────────────────────────────────── */

function PositionComposer({
  open,
  onClose,
  onAdd,
  quotes,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: ReturnType<typeof usePersonal>["addPosition"];
  quotes: Map<string, { price: number }>;
}) {
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [openedAt, setOpenedAt] = useState("");

  const instrument = slug ? findBySlug(slug) : null;
  const suggestions = useMemo(
    () => (query.trim() && !slug ? searchUniverse(query, 6) : []),
    [query, slug],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSlug(null);
      setQuantity("");
      setAvgPrice("");
      setOpenedAt("");
    }
  }, [open]);

  // Pre-fill the cost basis with the live price. Most positions being added
  // are recent, and it saves a lookup in another tab.
  useEffect(() => {
    if (!slug) return;
    const price = quotes.get(slug)?.price;
    if (price != null && !avgPrice) setAvgPrice(price.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const qty = Number(quantity);
  const price = Number(avgPrice);
  const valid = instrument && Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0;

  const submit = () => {
    if (!valid || !instrument) return;
    onAdd({
      slug: instrument.slug,
      symbol: instrument.symbol,
      name: instrument.name,
      currency: instrument.currency,
      quantity: qty,
      avgPrice: price,
      ...(openedAt ? { openedAt: new Date(openedAt).getTime() } : {}),
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75]" role="dialog" aria-modal aria-label="Add position">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-1000/70 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-1/2 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)]">
              <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <p className="label-micro text-signal">New position</p>
                  <h2 className="mt-2 text-[15px] text-ivory">Add to your book</h2>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-sm p-1.5 text-ivory-40 transition-colors hover:bg-ink-800 hover:text-ivory"
                  aria-label="Close"
                >
                  <IconClose />
                </button>
              </header>

              <div className="space-y-4 p-5">
                {instrument ? (
                  <div className="flex items-center justify-between gap-3 rounded-sm border border-line-strong bg-ink-850 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="num-mono block text-[13px] text-ivory">{instrument.symbol}</span>
                      <span className="block truncate text-[11px] text-ivory-40">{instrument.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={instrument.region === "IN" ? "india" : "usa"}>
                        {instrument.exchange}
                      </Badge>
                      <button
                        onClick={() => {
                          setSlug(null);
                          setQuery("");
                          setAvgPrice("");
                        }}
                        className="rounded-sm p-1 text-ivory-40 hover:text-ivory"
                        aria-label="Change instrument"
                      >
                        <IconClose className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      label="Instrument"
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search ticker or company…"
                      leading={<IconSearch />}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && suggestions[0]) setSlug(suggestions[0].slug);
                      }}
                    />
                    {suggestions.length > 0 && (
                      <ul className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-sm border border-line-strong bg-ink-850 shadow-lg">
                        {suggestions.map((inst) => (
                          <li key={inst.slug}>
                            <button
                              onClick={() => setSlug(inst.slug)}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-ink-800"
                            >
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
                      </ul>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Quantity"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                  <Input
                    label={`Average cost${instrument ? ` (${instrument.currency})` : ""}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={avgPrice}
                    onChange={(e) => setAvgPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <Input
                  label="Opened on (optional)"
                  type="date"
                  value={openedAt}
                  onChange={(e) => setOpenedAt(e.target.value)}
                  hint={openedAt ? formatDate(new Date(openedAt)) : "Defaults to today"}
                />

                {valid && instrument && (
                  <div className="rounded-sm border border-line bg-ink-850 px-3.5 py-3">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-ivory-60">Cost basis</span>
                      <span className="num-mono text-[13px] text-ivory">
                        {formatPrice(qty * price, instrument.currency)}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <footer className="flex justify-end gap-2 border-t border-line bg-ink-950/50 px-5 py-3.5">
                <Button variant="ghost" size="md" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" size="md" onClick={submit} disabled={!valid}>
                  Add position
                </Button>
              </footer>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
