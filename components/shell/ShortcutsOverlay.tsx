"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { IconClose, IconKeyboard } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Keyboard control.
 *
 * The thing that actually makes a terminal feel like a terminal is that you
 * never have to reach for the mouse. `g` followed by a letter jumps between
 * sections — the Vim/Gmail idiom, chosen because it needs no modifier and so
 * never collides with the browser's own shortcuts. `?` shows this sheet.
 *
 * The chord has a one-second window: press `g`, and the next keystroke is
 * interpreted as a destination. After that it lapses, so a stray `g` while
 * reading never swallows the letter that follows it.
 */

const CHORD_WINDOW_MS = 1000;

interface Shortcut {
  keys: string[];
  label: string;
  group: "Navigation" | "Actions" | "Chart";
  href?: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["g", "d"], label: "Dashboard", group: "Navigation", href: "/dashboard" },
  { keys: ["g", "m"], label: "Markets", group: "Navigation", href: "/markets" },
  { keys: ["g", "s"], label: "Screener", group: "Navigation", href: "/screener" },
  { keys: ["g", "c"], label: "Compare", group: "Navigation", href: "/compare" },
  { keys: ["g", "n"], label: "Newsroom", group: "Navigation", href: "/news" },
  { keys: ["g", "w"], label: "Watchlist", group: "Navigation", href: "/watchlist" },
  { keys: ["g", "p"], label: "Portfolio", group: "Navigation", href: "/portfolio" },
  { keys: ["g", "a"], label: "Alerts", group: "Navigation", href: "/alerts" },

  { keys: ["⌘", "K"], label: "Open the command palette", group: "Actions" },
  { keys: ["/"], label: "Search symbols", group: "Actions" },
  { keys: ["?"], label: "Show this sheet", group: "Actions" },
  { keys: ["Esc"], label: "Close any overlay", group: "Actions" },

  { keys: ["1", "–", "7"], label: "Switch chart range", group: "Chart" },
  { keys: ["c"], label: "Toggle candles and area", group: "Chart" },
];

const CHORD_ROUTES: Record<string, string> = Object.fromEntries(
  SHORTCUTS.filter((s) => s.href && s.keys[0] === "g").map((s) => [s.keys[1]!, s.href!]),
);

export function ShortcutsOverlay() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chordArmed, setChordArmed] = useState(false);

  useEffect(() => {
    let chordTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      // Never hijack a key while the user is typing into something.
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        setOpen(false);
        setChordArmed(false);
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      if (chordArmed) {
        const href = CHORD_ROUTES[e.key.toLowerCase()];
        setChordArmed(false);
        if (chordTimer) clearTimeout(chordTimer);
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }

      if (e.key.toLowerCase() === "g") {
        setChordArmed(true);
        chordTimer = setTimeout(() => setChordArmed(false), CHORD_WINDOW_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (chordTimer) clearTimeout(chordTimer);
    };
  }, [chordArmed, router]);

  const groups = ["Navigation", "Actions", "Chart"] as const;

  return (
    <>
      {/* Chord indicator. Without visible feedback, a half-entered chord is
          indistinguishable from a dead keyboard. */}
      <AnimatePresence>
        {chordArmed && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="pointer-events-none fixed bottom-24 left-1/2 z-[85] -translate-x-1/2 rounded-md border border-signal/40 bg-ink-850/95 px-3.5 py-2.5 backdrop-blur-md md:bottom-16"
          >
            <p className="label-micro text-signal">Go to…</p>
            <p className="mt-1.5 text-[11px] text-ivory-60">
              <kbd className="num-mono rounded-[3px] border border-line px-1 py-px">d</kbd> dashboard{" "}
              <kbd className="num-mono ml-1 rounded-[3px] border border-line px-1 py-px">m</kbd> markets{" "}
              <kbd className="num-mono ml-1 rounded-[3px] border border-line px-1 py-px">w</kbd> watchlist{" "}
              <kbd className="num-mono ml-1 rounded-[3px] border border-line px-1 py-px">?</kbd> all
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-[85]"
            role="dialog"
            aria-modal
            aria-label="Keyboard shortcuts"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 bg-ink-1000/72 backdrop-blur-[3px]"
              onClick={() => setOpen(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-1/2 top-1/2 max-h-[86dvh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden"
            >
              <div className="flex max-h-[86dvh] flex-col overflow-hidden rounded-lg border border-line-strong bg-ink-900 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)]">
                <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <IconKeyboard className="text-signal" />
                    <h2 className="text-[15px] text-ivory">Keyboard shortcuts</h2>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-sm p-1.5 text-ivory-40 transition-colors hover:bg-ink-800 hover:text-ivory"
                    aria-label="Close"
                  >
                    <IconClose />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {groups.map((group) => (
                    <section key={group} className="mb-6 last:mb-0">
                      <p className="label-micro mb-3 text-ivory-40">{group}</p>
                      <ul className="space-y-1.5">
                        {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                          <li
                            key={s.label}
                            className="flex items-center justify-between gap-4 rounded-sm px-2 py-1.5 transition-colors hover:bg-ink-850"
                          >
                            <span className="text-[12px] text-ivory-80">{s.label}</span>
                            <span className="flex shrink-0 items-center gap-1">
                              {s.keys.map((k, i) => (
                                <kbd
                                  key={`${k}-${i}`}
                                  className={cn(
                                    "num-mono min-w-[22px] rounded-[3px] border border-line bg-ink-850 px-1.5 py-1 text-center text-[10px] text-ivory-60",
                                    k === "–" && "border-transparent bg-transparent",
                                  )}
                                >
                                  {k}
                                </kbd>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>

                <footer className="border-t border-line bg-ink-950/50 px-5 py-3">
                  <p className="text-[11px] leading-relaxed text-ivory-40">
                    Navigation chords start with{" "}
                    <kbd className="num-mono rounded-[3px] border border-line px-1 py-px text-ivory-60">g</kbd>{" "}
                    and expire after a second. Shortcuts are suspended while a text field has
                    focus.
                  </p>
                </footer>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
