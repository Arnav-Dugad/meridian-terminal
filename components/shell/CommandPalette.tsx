"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { searchUniverse, type Instrument } from "@/lib/market/universe";
import { usePersonal } from "@/lib/store/personal";
import {
  IconBell,
  IconBriefcase,
  IconChart,
  IconCoin,
  IconFilter,
  IconGlobe,
  IconLayers,
  IconNews,
  IconPulse,
  IconScale,
  IconSearch,
  IconSettings,
  IconStar,
} from "@/components/ui/icons";
import { Badge } from "@/components/ui/primitives";

/**
 * The command palette.
 *
 * This is the primary way to move around the terminal — the sidebar exists for
 * discovery, but anyone using this daily will live in Cmd-K. It searches the
 * instrument universe and the navigation graph in one list, and it is the only
 * place in the app where a keystroke can reach every surface.
 *
 * Notable behaviours:
 *  - Typing a ticker and pressing Enter goes straight there. No result click.
 *  - Recent symbols persist, so the empty state is useful rather than blank.
 *  - Actions are contextual: a symbol row offers "watch" alongside "open".
 */

interface CommandPaletteValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteValue | null>(null);

const MAX_RECENTS = 6;

interface NavCommand {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: ReactNode;
  keywords: string;
}

const NAV_COMMANDS: NavCommand[] = [
  { id: "dashboard", label: "Dashboard", hint: "Cross-market overview", href: "/dashboard", icon: <IconPulse />, keywords: "home overview pulse" },
  { id: "markets", label: "Markets", hint: "Indices, breadth, sectors and crypto", href: "/markets", icon: <IconGlobe />, keywords: "indices heatmap sectors breadth crypto" },
  { id: "screener", label: "Screener", hint: "Filter every market on live metrics", href: "/screener", icon: <IconFilter />, keywords: "filter scan search stocks" },
  { id: "compare", label: "Compare", hint: "Normalised performance and correlation", href: "/compare", icon: <IconScale />, keywords: "correlation versus relative beta" },
  { id: "news", label: "Newsroom", hint: "Market and company headlines", href: "/news", icon: <IconNews />, keywords: "news headlines press articles" },
  { id: "watchlist", label: "Watchlist", hint: "Your tracked instruments", href: "/watchlist", icon: <IconStar />, keywords: "saved favourites starred" },
  { id: "portfolio", label: "Portfolio", hint: "Holdings, P&L and risk", href: "/portfolio", icon: <IconBriefcase />, keywords: "holdings positions pnl profit returns" },
  { id: "flows", label: "Institutional flows", hint: "What foreign and domestic money did today", href: "/flows", icon: <IconScale />, keywords: "fii dii foreign domestic institutions india buying selling" },
  { id: "alerts", label: "Alerts", hint: "Price triggers", href: "/alerts", icon: <IconBell />, keywords: "notifications triggers price" },
  { id: "settings", label: "Settings", hint: "Theme, currency, charts and your data", href: "/settings", icon: <IconSettings />, keywords: "preferences theme light dark mode account export" },
];

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // A bare "/" opens search too, as long as the user is not already typing.
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </CommandPaletteContext.Provider>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useCommandPalette(): CommandPaletteValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

/* ── The palette itself ───────────────────────────────────────────────────── */

type Row =
  | { kind: "nav"; command: NavCommand }
  | { kind: "symbol"; instrument: Instrument };

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  // Recents come from the shared personal store rather than a private
  // localStorage key, so history follows the account across devices along with
  // everything else — and there is one source of truth for "recently viewed"
  // instead of two that drift.
  const { toggleWatch, isWatched, recentlyViewed, recordView } = usePersonal();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const recents = recentlyViewed.slice(0, MAX_RECENTS);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Wait a frame so the element exists and the entrance has begun.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Lock the page behind the overlay, compensating for the scrollbar so the
  // layout does not jump sideways when it disappears.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      const recentRows: Row[] = recents
        .map((slug) => searchUniverse(slug, 1)[0])
        .filter((i): i is Instrument => Boolean(i))
        .map((instrument) => ({ kind: "symbol" as const, instrument }));
      return [...recentRows, ...NAV_COMMANDS.map((command) => ({ kind: "nav" as const, command }))];
    }

    const navMatches = NAV_COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q),
    ).map((command) => ({ kind: "nav" as const, command }));

    const symbolMatches = searchUniverse(query, 8).map((instrument) => ({
      kind: "symbol" as const,
      instrument,
    }));

    // Symbols lead: in a terminal, a typed string is a ticker until proven
    // otherwise.
    return [...symbolMatches, ...navMatches];
  }, [query, recents]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const activate = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      if (row.kind === "nav") {
        router.push(row.command.href);
      } else {
        recordView(row.instrument.slug);
        router.push(`/stock/${encodeURIComponent(row.instrument.slug)}`);
      }
      onClose();
    },
    [router, onClose, recordView],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
        e.preventDefault();
        setCursor((c) => (c + 1) % Math.max(1, rows.length));
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
        e.preventDefault();
        setCursor((c) => (c - 1 + rows.length) % Math.max(1, rows.length));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        activate(rows[cursor]);
        return;
      }
      // Cmd-Enter on a symbol toggles the watchlist without leaving the palette.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const row = rows[cursor];
        if (row?.kind === "symbol") toggleWatch(row.instrument.slug);
      }
    },
    [rows, cursor, activate, onClose, toggleWatch],
  );

  // Keep the highlighted row inside the scroll viewport during keyboard travel.
  useEffect(() => {
    const list = listRef.current;
    const node = list?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal aria-label="Command palette">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink-1000/72 backdrop-blur-[3px]"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-[12vh] w-[min(620px,calc(100vw-2rem))] -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)]">
              <div className="flex items-center gap-3 border-b border-line px-4">
                <IconSearch className="shrink-0 text-ivory-40" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Search RELIANCE, NVDA, screener…"
                  aria-label="Search symbols and commands"
                  className="h-13 w-full bg-transparent py-4 text-sm text-ivory outline-none placeholder:text-ivory-40"
                />
                <kbd className="label-micro-tight shrink-0 rounded-[3px] border border-line px-1.5 py-1 text-ivory-40">
                  ESC
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[54vh] overflow-y-auto p-1.5">
                {rows.length === 0 && (
                  <p className="px-3 py-8 text-center text-[12px] text-ivory-40">
                    Nothing matches “{query}”.
                  </p>
                )}

                {!query && recents.length > 0 && (
                  <p className="label-micro px-2.5 pb-1.5 pt-2 text-ivory-40">Recent</p>
                )}

                {rows.map((row, index) => {
                  const active = index === cursor;
                  const isFirstNav =
                    row.kind === "nav" && (index === 0 || rows[index - 1]?.kind === "symbol");

                  return (
                    <div key={row.kind === "nav" ? row.command.id : row.instrument.slug}>
                      {isFirstNav && (
                        <p className="label-micro px-2.5 pb-1.5 pt-3 text-ivory-40">Go to</p>
                      )}
                      <button
                        data-index={index}
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => activate(row)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors duration-100",
                          active ? "bg-ink-750" : "hover:bg-ink-850",
                        )}
                      >
                        {row.kind === "nav" ? (
                          <>
                            <span className={cn("shrink-0", active ? "text-signal" : "text-ivory-40")}>
                              {row.command.icon}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-ivory">
                                {row.command.label}
                              </span>
                              <span className="block truncate text-[11px] text-ivory-40">
                                {row.command.hint}
                              </span>
                            </span>
                          </>
                        ) : (
                          <>
                            <span className={cn("shrink-0", active ? "text-signal" : "text-ivory-40")}>
                              {row.instrument.kind === "crypto" ? <IconCoin /> : <IconChart />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="num-mono truncate text-[13px] font-medium text-ivory">
                                  {row.instrument.symbol}
                                </span>
                                {isWatched(row.instrument.slug) && (
                                  <IconStar className="h-3 w-3 text-signal" />
                                )}
                              </span>
                              <span className="block truncate text-[11px] text-ivory-40">
                                {row.instrument.name}
                              </span>
                            </span>
                            <Badge
                              tone={
                                row.instrument.region === "IN"
                                  ? "india"
                                  : row.instrument.region === "GLOBAL"
                                    ? "crypto"
                                    : "usa"
                              }
                            >
                              {row.instrument.exchange}
                            </Badge>
                          </>
                        )}
                        {active && (
                          <kbd className="label-micro-tight hidden shrink-0 rounded-[3px] border border-line px-1.5 py-1 text-ivory-40 sm:block">
                            ↵
                          </kbd>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-ink-950/60 px-3.5 py-2">
                <div className="flex items-center gap-3.5">
                  <Hint keys="↑↓" label="Navigate" />
                  <Hint keys="↵" label="Open" />
                </div>
                <span className="label-micro-tight text-ivory-40">
                  <IconLayers className="mr-1 inline h-3 w-3 align-[-1px]" />
                  {rows.length} result{rows.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="label-micro-tight rounded-[3px] border border-line px-1.5 py-0.5 text-ivory-60">
        {keys}
      </kbd>
      <span className="label-micro-tight text-ivory-40">{label}</span>
    </span>
  );
}
