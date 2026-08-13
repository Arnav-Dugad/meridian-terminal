"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { usePersonal } from "@/lib/store/personal";
import { useCommandPalette } from "@/components/shell/CommandPalette";
import { AlertWatcher } from "@/components/shell/AlertWatcher";
import { ShortcutsOverlay } from "@/components/shell/ShortcutsOverlay";
import { PreferenceSync } from "@/components/shell/PreferenceSync";
import { MobileNav } from "@/components/shell/MobileNav";
import { Glyph } from "@/components/brand/Wordmark";
import { Tape } from "@/components/market/Tape";
import { MarketClocks } from "@/components/shell/MarketClocks";
import { Badge, Button, StatusDot } from "@/components/ui/primitives";
import { DEFAULT_WATCHLIST } from "@/lib/market/universe";
import {
  IconActivity,
  IconBell,
  IconBriefcase,
  IconChevronDown,
  IconClock,
  IconFilter,
  IconGlobe,
  IconLayers,
  IconLogout,
  IconNews,
  IconPulse,
  IconScale,
  IconSearch,
  IconSettings,
  IconSpark,
  IconStar,
  IconUser,
} from "@/components/ui/icons";

/**
 * The terminal shell.
 *
 * A fixed rail, a status bar, and a tape along the bottom — the layout every
 * professional trading application converges on, because it keeps the two
 * things a trader glances at (what is open, what is moving) permanently
 * visible while the working area changes underneath.
 *
 * The rail collapses to icons and remembers that choice. Navigation uses a
 * shared layout id so the active indicator slides between items rather than
 * blinking, which is the difference between the rail feeling like one control
 * and feeling like seven links.
 */

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: <IconPulse /> },
  { href: "/workspace", label: "Workspace", icon: <IconLayers /> },
  { href: "/markets", label: "Markets", icon: <IconGlobe /> },
  { href: "/screener", label: "Screener", icon: <IconFilter /> },
  { href: "/compare", label: "Compare", icon: <IconScale /> },
  { href: "/flows", label: "Flows", icon: <IconActivity /> },
  { href: "/deals", label: "Big trades", icon: <IconLayers /> },
  { href: "/actions", label: "Actions", icon: <IconSpark /> },
  { href: "/earnings", label: "Earnings", icon: <IconClock /> },
  { href: "/news", label: "Newsroom", icon: <IconNews /> },
  { href: "/watchlist", label: "Watchlist", icon: <IconStar /> },
  { href: "/portfolio", label: "Portfolio", icon: <IconBriefcase /> },
  { href: "/alerts", label: "Alerts", icon: <IconBell /> },
];

/**
 * The four that earn a permanent slot on a phone. Everything else lives in the
 * "More" sheet — reachable in two taps, rather than only through a keyboard
 * shortcut on a device with no keyboard.
 */
const MOBILE_PRIMARY = ["/dashboard", "/markets", "/watchlist", "/portfolio"];

const RAIL_KEY = "meridian.rail.collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { watchlist, alerts, preferences } = usePersonal();

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(window.localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleRail = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  const activeAlerts = alerts.filter((a) => a.active).length;
  const tapeSymbols = watchlist.length > 0 ? watchlist.slice(0, 24) : DEFAULT_WATCHLIST;
  const showTape = preferences.showTape;

  // Split the rail into a phone tab bar and the overflow sheet. Settings is
  // appended to the sheet because it has no place in the rail's main list but
  // must still be reachable without a keyboard.
  const withBadges = NAV.map((item) => ({
    ...item,
    ...(item.href === "/alerts" && activeAlerts > 0 ? { badge: activeAlerts } : {}),
  }));
  const mobilePrimary = MOBILE_PRIMARY.map((href) => withBadges.find((n) => n.href === href)).filter(
    (n): n is (typeof withBadges)[number] => Boolean(n),
  );
  const mobileOverflow = [
    ...withBadges.filter((n) => !MOBILE_PRIMARY.includes(n.href)),
    { href: "/settings", label: "Settings", icon: <IconSettings /> },
  ];

  return (
    // `overflow-x-clip` rather than `-hidden`: hidden would make this a scroll
    // container and take scrolling away from the document. See globals.css.
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-ink-950">
      <AlertWatcher />
      <ShortcutsOverlay />
      <PreferenceSync />

      <div className="flex flex-1">
        {/* ── Rail ────────────────────────────────────────────────────────── */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-ink-1000 md:flex",
            "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            collapsed ? "w-[60px]" : "w-[204px]",
          )}
        >
          <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
            <Link href="/" aria-label="Meridian home" className="shrink-0">
              <Glyph size={20} className="text-ivory" />
            </Link>
            {!collapsed && (
              <span className="truncate text-[14px] font-medium tracking-[-0.01em] text-ivory">
                Meridian
              </span>
            )}
          </div>

          <nav className="flex-1 space-y-0.5 p-2" aria-label="Terminal sections">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const badge = item.href === "/alerts" && activeAlerts > 0 ? activeAlerts : null;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex h-9 items-center gap-3 rounded-sm px-2.5 transition-colors duration-150",
                    active ? "text-ivory" : "text-ivory-60 hover:bg-ink-850 hover:text-ivory",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="rail-active"
                      className="absolute inset-0 rounded-sm bg-ink-800"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  {active && (
                    <motion.span
                      layoutId="rail-marker"
                      className="absolute -left-2 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className={cn("relative z-10 shrink-0", active && "text-signal")}>
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span className="relative z-10 flex-1 truncate text-[13px]">{item.label}</span>
                  )}
                  {badge != null && !collapsed && (
                    <span className="num-mono relative z-10 rounded-[3px] bg-signal/15 px-1.5 py-px text-[10px] text-signal">
                      {badge}
                    </span>
                  )}
                  {badge != null && collapsed && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="space-y-0.5 border-t border-line p-2">
            <Link
              href="/settings"
              title={collapsed ? "Settings" : undefined}
              className={cn(
                "flex h-9 items-center gap-3 rounded-sm px-2.5 transition-colors duration-150",
                pathname.startsWith("/settings")
                  ? "bg-ink-800 text-ivory"
                  : "text-ivory-60 hover:bg-ink-850 hover:text-ivory",
              )}
            >
              <IconSettings
                className={cn("shrink-0", pathname.startsWith("/settings") && "text-signal")}
              />
              {!collapsed && <span className="truncate text-[13px]">Settings</span>}
            </Link>

            <button
              onClick={toggleRail}
              className="flex h-8 w-full items-center gap-3 rounded-sm px-2.5 text-ivory-40 transition-colors hover:bg-ink-850 hover:text-ivory-80"
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              <IconChevronDown
                className={cn(
                  "shrink-0 transition-transform duration-300",
                  collapsed ? "-rotate-90" : "rotate-90",
                )}
              />
              {!collapsed && <span className="text-[12px]">Collapse</span>}
            </button>
          </div>
        </aside>

        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />

          {/*
            `min-w-0` is load-bearing: without it a flex child adopts its
            content's intrinsic width, so one wide table pushes the whole
            column past the viewport and the page scrolls sideways. This is the
            single most common cause of horizontal bleed in a flex layout.
          */}
          <main id="main" className="pb-chrome min-w-0 flex-1 overflow-x-clip">
            {mounted ? (
              children
            ) : (
              // Suppresses a flash of rail-width shift before the stored
              // preference is read.
              <div className="opacity-0">{children}</div>
            )}
          </main>
        </div>
      </div>

      {/* ── Bottom chrome ─────────────────────────────────────────────────
          Tape and mobile nav are stacked in one fixed container rather than
          positioned independently. Two separately-offset fixed bars is how
          they end up overlapping the moment either changes height. */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30">
        <MobileNav
          pathname={pathname}
          primary={mobilePrimary}
          overflow={mobileOverflow}
        />
        {showTape && (
          <div className="border-t border-line bg-ink-1000/92 backdrop-blur-md">
            <Tape symbols={tapeSymbols} speed={1.15} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Topbar ───────────────────────────────────────────────────────────────── */

function Topbar() {
  const { setOpen } = useCommandPalette();
  const { mode } = usePersonal();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-ink-950/88 px-3 backdrop-blur-xl sm:px-5">
      <button
        onClick={() => setOpen(true)}
        className="group flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-sm border border-line bg-ink-900 px-3 text-left transition-colors duration-150 hover:border-line-strong hover:bg-ink-850 sm:max-w-[300px]"
      >
        <IconSearch className="shrink-0 text-ivory-40 transition-colors group-hover:text-ivory-60" />
        <span className="flex-1 truncate text-[12px] text-ivory-40">Search symbols…</span>
        <kbd className="label-micro-tight hidden shrink-0 rounded-[3px] border border-line px-1.5 py-0.5 text-ivory-40 sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <MarketClocks className="hidden lg:flex" />
        {mode === "local" && (
          <Badge tone="neutral" className="hidden xl:inline-flex">
            Local storage
          </Badge>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}

/* ── Account menu ─────────────────────────────────────────────────────────── */

function AccountMenu() {
  const { user, signOut, configured } = useAuth();
  const { mode } = usePersonal();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Deferred so the click that opened the menu does not immediately close it.
    const timer = setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
    };
  }, [open]);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login" className="hidden sm:block">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
        <Link href="/signup">
          <Button variant="primary" size="sm">
            {configured ? "Create account" : "Get started"}
          </Button>
        </Link>
      </div>
    );
  }

  const initials = (user.displayName ?? user.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-8 items-center gap-2 rounded-sm border border-line bg-ink-900 pl-1 pr-2 transition-colors hover:border-line-strong hover:bg-ink-850"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="num-mono flex h-6 w-6 items-center justify-center rounded-[3px] bg-signal/15 text-[10px] font-semibold text-signal">
          {initials || <IconUser className="h-3.5 w-3.5" />}
        </span>
        <IconChevronDown className="h-3 w-3 text-ivory-40" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-10 z-50 w-[236px] overflow-hidden rounded-md border border-line-strong bg-ink-900 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.8)]"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line px-3.5 py-3">
              <p className="truncate text-[13px] text-ivory">{user.displayName ?? "Signed in"}</p>
              <p className="mt-0.5 truncate text-[11px] text-ivory-40">{user.email}</p>
              <p className="mt-2.5 flex items-center gap-1.5">
                <StatusDot tone={mode === "cloud" ? "up" : "signal"} />
                <span className="label-micro-tight text-ivory-40">
                  {mode === "cloud" ? "Syncing to cloud" : "Saved on this device"}
                </span>
              </p>
            </div>

            <div className="p-1">
              <button
                onClick={() => void signOut()}
                className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] text-ivory-60 transition-colors hover:bg-ink-800 hover:text-ivory"
                role="menuitem"
              >
                <IconLogout className="shrink-0" />
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

