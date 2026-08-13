"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { PriceChart } from "@/components/chart/PriceChart";
import {
  Badge,
  Button,
  Delta,
  EmptyState,
  Input,
  Panel,
  Segmented,
} from "@/components/ui/primitives";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import {
  IconArrowUpRight,
  IconClose,
  IconLayers,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { useQuotes } from "@/lib/hooks/market-data";
import { useSeries } from "@/lib/hooks/use-series";
import { findBySlug, searchUniverse, DEFAULT_WATCHLIST } from "@/lib/market/universe";
import { RANGE_KEYS, RANGE_SPEC, type RangeKey } from "@/lib/twelvedata/types";
import type { WorkspacePane } from "@/lib/store/types";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The workspace.
 *
 * Four instruments on one screen, each with its own range and style, saved as
 * a named layout. This is the single feature that most separates a terminal
 * from a website: you stop navigating and start watching, and the arrangement
 * you built yesterday is the arrangement you get today.
 *
 * Every pane subscribes through the same shared quote store, so four charts
 * cost one connection rather than four.
 */

const DEFAULT_PANES: WorkspacePane[] = [
  { slug: "NIFTY50", range: "6M", style: "area" },
  { slug: "SPX", range: "6M", style: "area" },
  { slug: "RELIANCE.NSE", range: "6M", style: "area" },
  { slug: "NVDA", range: "6M", style: "area" },
];

export function WorkspaceView() {
  const { workspaces, saveWorkspace, removeWorkspace, ready } = usePersonal();

  const [panes, setPanes] = useState<WorkspacePane[]>(DEFAULT_PANES);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);

  // Load the most recent saved layout on first arrival, so returning to the
  // page resumes where you were rather than resetting to a demo.
  useEffect(() => {
    if (!ready || activeId !== null || workspaces.length === 0) return;
    const first = workspaces[0]!;
    setPanes(first.panes);
    setName(first.name);
    setActiveId(first.id);
  }, [ready, workspaces, activeId]);

  const slugs = useMemo(() => panes.map((p) => p.slug), [panes]);
  const { quotes } = useQuotes(slugs);

  const update = useCallback((index: number, patch: Partial<WorkspacePane>) => {
    setPanes((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    setDirty(true);
  }, []);

  const removePane = useCallback((index: number) => {
    setPanes((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  const addPane = useCallback((slug: string) => {
    setPanes((prev) =>
      prev.length >= 4 ? prev : [...prev, { slug, range: "6M" as RangeKey, style: "area" as const }],
    );
    setDirty(true);
    setPicking(null);
  }, []);

  const load = useCallback((id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    setPanes(ws.panes);
    setName(ws.name);
    setActiveId(ws.id);
    setDirty(false);
  }, [workspaces]);

  const save = useCallback(() => {
    const id = saveWorkspace(name || `Layout ${workspaces.length + 1}`, panes, activeId ?? undefined);
    setActiveId(id);
    setDirty(false);
  }, [saveWorkspace, name, panes, activeId, workspaces.length]);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Four charts, one screen"
        description="Build the view you actually watch, then save it. Each pane keeps its own range and style, and every layout is waiting for you next time."
        meta={
          <>
            <Badge tone="neutral">{panes.length} of 4 panes</Badge>
            {dirty && <Badge tone="signal">Unsaved changes</Badge>}
            {workspaces.length > 0 && <Badge tone="neutral">{workspaces.length} saved</Badge>}
          </>
        }
        actions={
          <>
            <div className="w-[170px]">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
                placeholder="Name this layout"
                aria-label="Layout name"
              />
            </div>
            <Button variant="primary" size="md" onClick={save} disabled={panes.length === 0}>
              {activeId ? "Save" : "Save layout"}
            </Button>
          </>
        }
      />

      <PageBody className="space-y-4">
        {/* Saved layouts */}
        {workspaces.length > 0 && (
          <div className="scroll-x flex items-center gap-2">
            {workspaces.map((ws) => (
              <div key={ws.id} className="group relative shrink-0">
                <button
                  onClick={() => load(ws.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border py-2 pl-3 pr-8 text-left transition-colors",
                    activeId === ws.id
                      ? "border-signal/50 bg-signal/[0.08] text-ivory"
                      : "border-line text-ivory-60 hover:border-line-bright hover:text-ivory",
                  )}
                >
                  <IconLayers className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[16ch] truncate text-[12px]">{ws.name}</span>
                  <span className="num-mono text-[10px] text-ivory-40">{ws.panes.length}</span>
                </button>
                <button
                  onClick={() => {
                    removeWorkspace(ws.id);
                    if (activeId === ws.id) setActiveId(null);
                  }}
                  aria-label={`Delete ${ws.name}`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ivory-25 opacity-0 transition-all hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <IconClose className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {panes.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={<IconLayers />}
              title="Empty workspace"
              description="Add up to four instruments and arrange them however you watch the market."
              action={
                <Button
                  variant="primary"
                  size="md"
                  icon={<IconPlus />}
                  onClick={() => setPicking(0)}
                >
                  Add an instrument
                </Button>
              }
            />
          </Panel>
        ) : (
          <div
            className={cn(
              "grid gap-4",
              // A 2×2 grid on desktop; stacked on anything narrower, because
              // four charts side by side on a phone is four unreadable charts.
              panes.length > 1 ? "xl:grid-cols-2" : "grid-cols-1",
            )}
          >
            {panes.map((pane, i) => (
              <Pane
                key={`${pane.slug}-${i}`}
                pane={pane}
                quote={quotes[i]}
                index={i}
                onChange={(patch) => update(i, patch)}
                onRemove={() => removePane(i)}
              />
            ))}

            {panes.length < 4 && (
              <button
                onClick={() => setPicking(panes.length)}
                className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line-strong text-ivory-40 transition-colors hover:border-signal/40 hover:text-ivory-80"
              >
                <IconPlus />
                <span className="text-[12px]">Add a pane</span>
              </button>
            )}
          </div>
        )}
      </PageBody>

      <PanePicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={addPane}
        exclude={slugs}
      />
    </>
  );
}

/* ── One pane ─────────────────────────────────────────────────────────────── */

function Pane({
  pane,
  quote,
  index,
  onChange,
  onRemove,
}: {
  pane: WorkspacePane;
  quote: ReturnType<typeof useQuotes>["quotes"][number];
  index: number;
  onChange: (patch: Partial<WorkspacePane>) => void;
  onRemove: () => void;
}) {
  const instrument = findBySlug(pane.slug);
  const { series, loading } = useSeries(pane.slug, pane.range);
  const candles = series?.candles ?? [];

  if (!instrument) return null;

  const currency = instrument.currency;
  const intraday =
    RANGE_SPEC[pane.range].interval.includes("min") || RANGE_SPEC[pane.range].interval === "1h";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="panel bevel group min-w-0 overflow-hidden"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-6 w-[2px] shrink-0 rounded-full opacity-70"
            style={{
              backgroundColor:
                instrument.region === "IN"
                  ? "#f0a63c"
                  : instrument.region === "GLOBAL"
                    ? "#4fd1c5"
                    : "#7ba7f0",
            }}
          />
          <Link href={`/stock/${encodeURIComponent(pane.slug)}`} className="group/link min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="num-mono text-[13px] font-medium text-ivory">
                {instrument.symbol}
              </span>
              <IconArrowUpRight className="h-3 w-3 text-ivory-25 opacity-0 transition-opacity group-hover/link:opacity-100" />
            </span>
            <span className="mt-0.5 block max-w-[22ch] truncate text-[10px] text-ivory-40">
              {instrument.name}
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2.5">
          {quote && (
            <span className="flex items-baseline gap-2">
              <span className="num-mono text-[13px] text-ivory">
                <AnimatedNumber
                  value={quote.price}
                  format={(v) => formatPrice(v, currency)}
                  flash
                />
              </span>
              <Delta value={quote.changePercent} size="xs" />
            </span>
          )}
          <button
            onClick={onRemove}
            aria-label={`Remove ${instrument.symbol}`}
            className="rounded-sm p-1 text-ivory-25 opacity-0 transition-all hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <Segmented
          size="xs"
          value={pane.range}
          onChange={(v) => onChange({ range: v as RangeKey })}
          layoutIdSuffix={`ws-range-${index}`}
          options={RANGE_KEYS.map((k) => ({ value: k, label: k }))}
        />
        <Segmented
          size="xs"
          value={pane.style}
          onChange={(v) => onChange({ style: v as WorkspacePane["style"] })}
          layoutIdSuffix={`ws-style-${index}`}
          options={[
            { value: "area", label: "Area" },
            { value: "candles", label: "Candles" },
          ]}
        />
      </div>

      <div className="px-1 py-2">
        <PriceChart
          candles={candles}
          currency={currency}
          style={pane.style}
          baseline={quote?.previousClose ?? null}
          intraday={intraday}
          loading={loading}
          showVolume={false}
          height={230}
        />
      </div>
    </motion.div>
  );
}

/* ── Picker ───────────────────────────────────────────────────────────────── */

function PanePicker({
  open,
  onClose,
  onPick,
  exclude,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (slug: string) => void;
  exclude: string[];
}) {
  const [query, setQuery] = useState("");
  const { watchlist } = usePersonal();

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const suggestions = useMemo(() => {
    const base = query.trim()
      ? searchUniverse(query, 10)
      : (watchlist.length > 0 ? watchlist : DEFAULT_WATCHLIST)
          .map((s) => findBySlug(s))
          .filter((i): i is NonNullable<typeof i> => Boolean(i))
          .slice(0, 10);
    return base.filter((i) => !exclude.includes(i.slug));
  }, [query, watchlist, exclude]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[75]" role="dialog" aria-modal aria-label="Add a pane">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-1000/70 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-[14vh] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)]">
              <div className="border-b border-line p-3">
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search an instrument…"
                  leading={<IconSearch />}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions[0]) onPick(suggestions[0].slug);
                  }}
                />
              </div>

              <ul className="max-h-[42vh] overflow-y-auto p-1.5">
                {suggestions.length === 0 && (
                  <li className="px-3 py-6 text-center text-[12px] text-ivory-40">
                    Nothing matches.
                  </li>
                )}
                {suggestions.map((inst) => (
                  <li key={inst.slug}>
                    <button
                      onClick={() => onPick(inst.slug)}
                      className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-ink-800"
                    >
                      <span className="num-mono text-[12px] text-ivory">{inst.symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ivory-40">
                        {inst.name}
                      </span>
                      <Badge
                        tone={
                          inst.region === "IN" ? "india" : inst.region === "GLOBAL" ? "crypto" : "usa"
                        }
                      >
                        {inst.exchange}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
