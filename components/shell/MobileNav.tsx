"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { IconClose, IconLayers } from "@/components/ui/icons";

/**
 * Mobile navigation.
 *
 * The terminal has grown to thirteen sections. A five-slot tab bar left eight
 * of them reachable only through the command palette, which on a phone means
 * effectively unreachable — most people never discover a keyboard shortcut on
 * a device with no keyboard.
 *
 * The fix is the pattern every native app converges on: four destinations that
 * earn a permanent slot, and a "More" tab opening a sheet with everything
 * else. The sheet is a real sheet — it drags, it has a grab handle, it dims
 * what is behind it, and it closes on a downward swipe — because a menu that
 * behaves like a web dropdown is the single clearest tell that an app is not
 * native.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Optional count shown as a dot or pill. */
  badge?: number;
}

export function MobileNav({
  primary,
  overflow,
  pathname,
}: {
  primary: NavItem[];
  overflow: NavItem[];
  pathname: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const overflowActive = overflow.some((item) => isActive(item.href));

  // Any navigation closes the sheet. Without this it survives the route change
  // and covers the page the user just asked for.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  // Lock the page behind the sheet, compensating for the scrollbar.
  useEffect(() => {
    if (!sheetOpen) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [sheetOpen]);

  return (
    <>
      <nav
        className="tap-none flex border-t border-line bg-ink-1000/95 backdrop-blur-md md:hidden"
        aria-label="Sections"
      >
        {primary.map((item) => (
          <Tab key={item.href} item={item} active={isActive(item.href)} />
        ))}

        <button
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          className={cn(
            "relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors",
            overflowActive || sheetOpen ? "text-signal" : "text-ivory-40 active:text-ivory-80",
          )}
        >
          {overflowActive && (
            <motion.span
              layoutId="mobile-active"
              className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-signal"
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            />
          )}
          <span className="relative">
            <IconLayers />
            {overflow.some((i) => (i.badge ?? 0) > 0) && (
              <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-signal" />
            )}
          </span>
          <span className="label-micro-tight">More</span>
        </button>
      </nav>

      <AnimatePresence>
        {sheetOpen && (
          <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal aria-label="All sections">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-ink-1000/72 backdrop-blur-[3px]"
              onClick={() => setSheetOpen(false)}
            />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              // Dismiss on a decisive downward drag or a fast flick, matching
              // what a native sheet does.
              onDragEnd={(_, info) => {
                if (info.offset.y > 90 || info.velocity.y > 550) setSheetOpen(false);
              }}
              className="safe-bottom absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-xl border-t border-line-strong bg-ink-900"
            >
              <div className="flex justify-center pb-1 pt-2.5">
                <span className="h-1 w-9 rounded-full bg-ink-600" aria-hidden />
              </div>

              <header className="flex items-center justify-between px-4 pb-3 pt-1">
                <h2 className="text-[15px] text-ivory">All sections</h2>
                <button
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                  className="rounded-sm p-1.5 text-ivory-40 transition-colors hover:bg-ink-800 hover:text-ivory"
                >
                  <IconClose />
                </button>
              </header>

              <div className="max-h-[calc(82dvh-72px)] overflow-y-auto px-3 pb-6">
                <div className="grid grid-cols-2 gap-2">
                  {overflow.map((item, i) => (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, delay: Math.min(i * 0.025, 0.2) }}
                    >
                      <Link
                        href={item.href}
                        className={cn(
                          "flex min-h-[68px] flex-col justify-between rounded-md border p-3 transition-colors",
                          isActive(item.href)
                            ? "border-signal/50 bg-signal/[0.08]"
                            : "border-line bg-ink-850 active:bg-ink-800",
                        )}
                      >
                        <span
                          className={cn(
                            "flex items-center justify-between",
                            isActive(item.href) ? "text-signal" : "text-ivory-60",
                          )}
                        >
                          {item.icon}
                          {(item.badge ?? 0) > 0 && (
                            <span className="num-mono rounded-[3px] bg-signal/15 px-1.5 py-px text-[10px] text-signal">
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "mt-2 text-[13px]",
                            isActive(item.href) ? "text-ivory" : "text-ivory-80",
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors",
        active ? "text-signal" : "text-ivory-40 active:text-ivory-80",
      )}
    >
      {active && (
        <motion.span
          layoutId="mobile-active"
          className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-signal"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <span className="relative">
        {item.icon}
        {(item.badge ?? 0) > 0 && (
          <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-signal" />
        )}
      </span>
      <span className="label-micro-tight max-w-full truncate">{item.label}</span>
    </Link>
  );
}
