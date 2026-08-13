"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Panel,
  PanelHeader,
  Segmented,
  StatusDot,
} from "@/components/ui/primitives";
import {
  IconBell,
  IconBriefcase,
  IconChart,
  IconClose,
  IconExternal,
  IconGlobe,
  IconLogout,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconUser,
} from "@/components/ui/icons";
import { usePersonal } from "@/lib/store/personal";
import { useAuth } from "@/lib/firebase/auth-context";
import { useTheme } from "@/lib/hooks/theme-context";
import { RANGE_KEYS, RANGE_SPEC } from "@/lib/twelvedata/types";
import type { Currency } from "@/lib/format";
import { formatRelative } from "@/lib/format";
import type { Preferences, ThemePreference } from "@/lib/store/types";
import {
  notificationPermission,
  requestNotificationPermission,
} from "@/components/shell/AlertWatcher";
import { cn } from "@/lib/utils";

/**
 * Settings.
 *
 * Every control writes straight through to the store — no Save button, no
 * pending state. A settings page that can be left in an uncommitted state is a
 * settings page that loses changes, and the immediacy is also the confirmation:
 * switch the theme and the page you are looking at changes under you.
 */

type SectionId = "appearance" | "markets" | "charts" | "portfolio" | "alerts" | "data" | "account";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <IconSettings /> },
  { id: "markets", label: "Markets", icon: <IconGlobe /> },
  { id: "charts", label: "Charts", icon: <IconChart /> },
  { id: "portfolio", label: "Portfolio", icon: <IconBriefcase /> },
  { id: "alerts", label: "Alerts", icon: <IconBell /> },
  { id: "data", label: "Your data", icon: <IconRefresh /> },
  { id: "account", label: "Account", icon: <IconUser /> },
];

export function SettingsView() {
  const [section, setSection] = useState<SectionId>("appearance");

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Make it yours"
        description="Everything here saves the moment you change it, and follows your account to every device you sign in on."
      />

      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
          {/* Section rail — a scrolling strip on phones, a list on desktop. */}
          <nav
            className="scroll-x -mx-1 flex gap-1 px-1 lg:mx-0 lg:flex-col lg:px-0"
            aria-label="Settings sections"
          >
            {SECTIONS.map((s) => {
              const active = s.id === section;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-sm px-3 py-2.5 text-left text-[13px] transition-colors",
                    active ? "text-ivory" : "text-ivory-60 hover:bg-ink-850 hover:text-ivory",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="settings-active"
                      className="absolute inset-0 rounded-sm bg-ink-800"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className={cn("relative z-10 shrink-0", active && "text-signal")}>
                    {s.icon}
                  </span>
                  <span className="relative z-10">{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-5"
              >
                {section === "appearance" && <AppearanceSection />}
                {section === "markets" && <MarketsSection />}
                {section === "charts" && <ChartsSection />}
                {section === "portfolio" && <PortfolioSection />}
                {section === "alerts" && <AlertsSection />}
                {section === "data" && <DataSection />}
                {section === "account" && <AccountSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </PageBody>
    </>
  );
}

/* ══ Appearance ═══════════════════════════════════════════════════════════ */

function AppearanceSection() {
  const { preferences, setPreference } = usePersonal();
  const { mode, setMode, resolved } = useTheme();

  // The theme lives in two places: localStorage for the pre-paint boot script,
  // and the synced preferences for cross-device continuity. Setting it writes
  // both, so a switch on a phone reaches a laptop.
  const applyTheme = useCallback(
    (next: ThemePreference) => {
      setMode(next);
      setPreference("theme", next);
    },
    [setMode, setPreference],
  );

  return (
    <>
      <Panel flush>
        <PanelHeader title="Theme" subtitle="Applies instantly, everywhere" />
        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { value: "dark", label: "Dark", hint: "Ink on black. Built for long sessions." },
                { value: "light", label: "Light", hint: "Paper. Easier in a bright room." },
                { value: "system", label: "System", hint: "Follows your device, changes with it." },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => applyTheme(opt.value)}
                aria-pressed={mode === opt.value}
                className={cn(
                  "rounded-md border p-3 text-left transition-all duration-150",
                  mode === opt.value
                    ? "border-signal/55 bg-signal/[0.07]"
                    : "border-line hover:border-line-bright hover:bg-ink-850",
                )}
              >
                <ThemeSwatch variant={opt.value} />
                <p className="mt-3 flex items-center gap-2 text-[13px] text-ivory">
                  {opt.label}
                  {mode === opt.value && <StatusDot tone="signal" />}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ivory-40">{opt.hint}</p>
              </button>
            ))}
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-ivory-40">
            Showing the <span className="text-ivory-60">{resolved}</span> palette right now.
            Charts, tables and every accent follow along.
          </p>
        </div>
      </Panel>

      <Panel flush>
        <PanelHeader title="Layout" />
        <div className="divide-y divide-line/60">
          <Row
            label="Density"
            hint="Compact tightens row heights and gutters so more fits on screen."
          >
            <Segmented
              value={preferences.density}
              onChange={(v) => setPreference("density", v as Preferences["density"])}
              layoutIdSuffix="set-density"
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          </Row>

          <Toggle
            label="Price tape"
            hint="The scrolling ribbon of live prices along the bottom of the screen."
            checked={preferences.showTape}
            onChange={(v) => setPreference("showTape", v)}
          />

          <Toggle
            label="Flash price changes"
            hint="Briefly tint a cell green or red as its price ticks — how a trading blotter behaves."
            checked={preferences.flashTicks}
            onChange={(v) => setPreference("flashTicks", v)}
          />

          <Toggle
            label="Reduce motion"
            hint="Cuts animation throughout without changing your device settings."
            checked={preferences.reducedMotion}
            onChange={(v) => setPreference("reducedMotion", v)}
          />
        </div>
      </Panel>
    </>
  );
}

/** A miniature of each theme, so the choice is visible before it is made. */
function ThemeSwatch({ variant }: { variant: "dark" | "light" | "system" }) {
  const dark = (
    <div className="flex h-full flex-col gap-1 bg-[#08080a] p-1.5">
      <div className="h-1 w-8 rounded-full bg-[#f0a63c]" />
      <div className="h-1 w-full rounded-full bg-[#2a2a33]" />
      <div className="h-1 w-3/4 rounded-full bg-[#2a2a33]" />
      <div className="mt-auto flex gap-1">
        <div className="h-1.5 w-1/2 rounded-full bg-[#3fbf7f]" />
        <div className="h-1.5 w-1/3 rounded-full bg-[#f0563f]" />
      </div>
    </div>
  );

  const light = (
    <div className="flex h-full flex-col gap-1 bg-[#f5f2ec] p-1.5">
      <div className="h-1 w-8 rounded-full bg-[#a8680a]" />
      <div className="h-1 w-full rounded-full bg-[#ddd8cd]" />
      <div className="h-1 w-3/4 rounded-full bg-[#ddd8cd]" />
      <div className="mt-auto flex gap-1">
        <div className="h-1.5 w-1/2 rounded-full bg-[#12874c]" />
        <div className="h-1.5 w-1/3 rounded-full bg-[#cf3520]" />
      </div>
    </div>
  );

  return (
    <div className="h-14 w-full overflow-hidden rounded-sm border border-line">
      {variant === "dark" && dark}
      {variant === "light" && light}
      {variant === "system" && (
        // Split down the middle, which is exactly what "system" means.
        <div className="grid h-full grid-cols-2">
          <div className="overflow-hidden">{dark}</div>
          <div className="overflow-hidden border-l border-line">{light}</div>
        </div>
      )}
    </div>
  );
}

/* ══ Markets ══════════════════════════════════════════════════════════════ */

function MarketsSection() {
  const { preferences, setPreference } = usePersonal();

  return (
    <Panel flush>
      <PanelHeader title="Markets" subtitle="What the terminal shows you first" />
      <div className="divide-y divide-line/60">
        <Row label="Home market" hint="Which market leads on the dashboard and markets pages.">
          <Segmented
            value={preferences.homeRegion}
            onChange={(v) => setPreference("homeRegion", v as Preferences["homeRegion"])}
            layoutIdSuffix="set-region"
            options={[
              { value: "IN", label: "India" },
              { value: "US", label: "US" },
              { value: "GLOBAL", label: "Crypto" },
            ]}
          />
        </Row>

        <Row
          label="Display currency"
          hint="Portfolio totals convert to this at the live rate. Individual quotes always show their own currency."
        >
          <Segmented
            value={preferences.baseCurrency}
            onChange={(v) => setPreference("baseCurrency", v as Currency)}
            layoutIdSuffix="set-currency"
            options={[
              { value: "INR", label: "₹ Rupees" },
              { value: "USD", label: "$ Dollars" },
            ]}
          />
        </Row>
      </div>
    </Panel>
  );
}

/* ══ Charts ═══════════════════════════════════════════════════════════════ */

function ChartsSection() {
  const { preferences, setPreference } = usePersonal();

  return (
    <Panel flush>
      <PanelHeader title="Charts" subtitle="Defaults applied whenever you open an instrument" />
      <div className="divide-y divide-line/60">
        <Row label="Default style">
          <Segmented
            value={preferences.chartStyle}
            onChange={(v) => setPreference("chartStyle", v as Preferences["chartStyle"])}
            layoutIdSuffix="set-style"
            options={[
              { value: "area", label: "Area" },
              { value: "candles", label: "Candles" },
            ]}
          />
        </Row>

        <Row label="Default range" hint="The time range a chart opens on.">
          <Segmented
            value={preferences.defaultRange}
            onChange={(v) => setPreference("defaultRange", v as Preferences["defaultRange"])}
            layoutIdSuffix="set-range"
            options={RANGE_KEYS.map((k) => ({ value: k, label: k, title: RANGE_SPEC[k].label }))}
          />
        </Row>

        <Row
          label="Risk-free rate"
          hint="Used by Sharpe, Sortino and the backtester. Roughly the yield on a 10-year government bond in your home market."
        >
          <div className="w-[150px]">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="25"
              value={String(preferences.riskFreeRate)}
              onChange={(e) => setPreference("riskFreeRate", Number(e.target.value) || 0)}
              trailing={<span className="text-[12px]">%</span>}
              aria-label="Risk-free rate"
            />
          </div>
        </Row>

        <Row
          label="Assumed trading cost"
          hint="Charged on both sides of every backtested trade. Frictionless backtests flatter active strategies badly."
        >
          <div className="w-[150px]">
            <Input
              type="number"
              step="1"
              min="0"
              max="100"
              value={String(preferences.backtestCostBps)}
              onChange={(e) => setPreference("backtestCostBps", Number(e.target.value) || 0)}
              trailing={<span className="text-[12px]">bps</span>}
              aria-label="Trading cost in basis points"
            />
          </div>
        </Row>
      </div>
    </Panel>
  );
}

/* ══ Portfolio ════════════════════════════════════════════════════════════ */

function PortfolioSection() {
  const { positions, snapshots, preferences } = usePersonal();

  return (
    <>
      <Panel flush>
        <PanelHeader title="Portfolio" />
        <div className="divide-y divide-line/60">
          <Row label="Positions held">
            <span className="num-mono text-[13px] text-ivory">{positions.length}</span>
          </Row>
          <Row
            label="Days of history"
            hint="A snapshot of your book is recorded each day you open the portfolio page."
          >
            <span className="num-mono text-[13px] text-ivory">{snapshots.length}</span>
          </Row>
          <Row label="Totals shown in">
            <span className="num-mono text-[13px] text-ivory">
              {preferences.baseCurrency === "INR" ? "₹ Rupees" : "$ Dollars"}
            </span>
          </Row>
        </div>
      </Panel>

      <Panel>
        <p className="text-[12px] leading-relaxed text-ivory-60">
          Positions are stored in the currency you bought them in, and converted only when
          totals are displayed. That means your reported value moves with the exchange rate
          as well as with the market — which is the honest picture when you hold assets
          across two countries.
        </p>
      </Panel>
    </>
  );
}

/* ══ Alerts ═══════════════════════════════════════════════════════════════ */

function AlertsSection() {
  const { alerts, preferences, setPreference } = usePersonal();
  const [permission, setPermission] = useState<string>("default");

  useEffect(() => setPermission(notificationPermission()), []);

  const active = alerts.filter((a) => a.active).length;

  return (
    <>
      <Panel flush>
        <PanelHeader title="Alerts" />
        <div className="divide-y divide-line/60">
          <Row label="Armed alerts">
            <span className="num-mono text-[13px] text-ivory">{active}</span>
          </Row>

          <Toggle
            label="Desktop notifications"
            hint="Raise a system notification when an alert fires, even if Meridian is in a background tab."
            checked={preferences.desktopNotifications && permission === "granted"}
            disabled={permission === "denied" || permission === "unsupported"}
            onChange={async (next) => {
              if (next && permission !== "granted") {
                const result = await requestNotificationPermission();
                setPermission(result);
                setPreference("desktopNotifications", result === "granted");
                return;
              }
              setPreference("desktopNotifications", next);
            }}
          />
        </div>
      </Panel>

      {permission === "denied" && (
        <Panel className="border-signal/30 bg-signal/[0.05]">
          <p className="text-[12px] leading-relaxed text-ivory-60">
            Notifications are blocked for this site in your browser settings. Alerts will
            still appear inside the terminal while it is open.
          </p>
        </Panel>
      )}
    </>
  );
}

/* ══ Your data ════════════════════════════════════════════════════════════ */

function DataSection() {
  const personal = usePersonal();
  const { watchlist, positions, alerts, notes, snapshots, recentlyViewed, savedScreens, mode, resetAll } =
    personal;
  const [confirming, setConfirming] = useState(false);

  const counts = [
    { label: "Watchlist", value: watchlist.length },
    { label: "Positions", value: positions.length },
    { label: "Alerts", value: alerts.length },
    { label: "Notes", value: notes.length },
    { label: "Saved screens", value: savedScreens.length },
    { label: "Portfolio history", value: snapshots.length },
    { label: "Recently viewed", value: recentlyViewed.length },
  ];

  /** Everything the app holds about you, as one file. */
  const exportData = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      watchlist,
      positions,
      alerts,
      notes,
      savedScreens,
      snapshots,
      recentlyViewed,
      preferences: personal.preferences,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meridian-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [watchlist, positions, alerts, notes, savedScreens, snapshots, recentlyViewed, personal.preferences]);

  return (
    <>
      <Panel flush>
        <PanelHeader
          title="What's stored"
          subtitle={
            mode === "cloud"
              ? "Synced to your account and available on every device"
              : "Saved on this device only — sign in to sync"
          }
          action={<Badge tone={mode === "cloud" ? "up" : "signal"}>{mode === "cloud" ? "Cloud" : "This device"}</Badge>}
        />
        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {counts.map((c) => (
            <div key={c.label} className="bg-ink-900 p-4">
              <dt className="label-micro text-ivory-40">{c.label}</dt>
              <dd className="num-mono mt-2 text-[18px] text-ivory">{c.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel flush>
        <PanelHeader title="Export" subtitle="Take everything with you" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-ivory-60">
            Downloads a single JSON file containing your watchlist, positions, alerts, notes
            and full portfolio history. Yours to keep, move, or back up.
          </p>
          <Button variant="secondary" size="md" icon={<IconExternal />} onClick={exportData}>
            Download my data
          </Button>
        </div>
      </Panel>

      <Panel flush>
        <PanelHeader title="Live data" subtitle="Where your prices are coming from" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-ivory-60">
            Meridian draws on several market data sources and switches between them
            automatically. If a figure ever looks stale, you can check what is responding.
          </p>
          <a href="/diagnostics">
            <Button variant="outline" size="md">
              Check data sources
            </Button>
          </a>
        </div>
      </Panel>

      <Panel flush className="border-down/25">
        <PanelHeader title="Reset" subtitle="This cannot be undone" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-ivory-60">
            Clears your watchlist, positions, alerts, notes and history, and restores the
            starter watchlist. Your account itself is not affected.
          </p>

          {confirming ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                icon={<IconTrash />}
                onClick={() => {
                  resetAll();
                  setConfirming(false);
                }}
              >
                Yes, erase everything
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="md" icon={<IconTrash />} onClick={() => setConfirming(true)}>
              Erase my data
            </Button>
          )}
        </div>
      </Panel>
    </>
  );
}

/* ══ Account ══════════════════════════════════════════════════════════════ */

function AccountSection() {
  const { user, signOut, configured } = useAuth();
  const { mode, migrated } = usePersonal();

  if (!user) {
    return (
      <Panel flush>
        <PanelHeader title="Account" />
        <EmptyState
          icon={<IconUser />}
          title="You're not signed in"
          description={
            configured
              ? "Everything you've set up is saved on this device. Create an account and it comes with you — nothing is lost."
              : "Accounts aren't available on this deployment. Your data is saved on this device."
          }
          action={
            configured ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <a href="/signup">
                  <Button variant="primary" size="md">
                    Create an account
                  </Button>
                </a>
                <a href="/login">
                  <Button variant="outline" size="md">
                    Sign in
                  </Button>
                </a>
              </div>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return (
    <>
      <Panel flush>
        <PanelHeader title="Account" />
        <div className="divide-y divide-line/60">
          <Row label="Name">
            <span className="text-[13px] text-ivory">{user.displayName ?? "—"}</span>
          </Row>
          <Row label="Email">
            <span className="num-mono text-[12px] text-ivory">{user.email}</span>
          </Row>
          <Row label="Sync">
            <span className="flex items-center gap-2">
              <StatusDot tone={mode === "cloud" ? "up" : "signal"} live={mode === "cloud"} />
              <span className="text-[12px] text-ivory-60">
                {mode === "cloud" ? "Active" : "Local only"}
              </span>
            </span>
          </Row>
        </div>
      </Panel>

      {migrated && (
        <Panel className="border-up/30 bg-up/[0.05]">
          <p className="text-[12px] leading-relaxed text-ivory-60">
            Everything you set up before signing in has been added to your account.
          </p>
        </Panel>
      )}

      <Panel flush>
        <PanelHeader title="Sign out" />
        <div className="flex items-center justify-between gap-4 p-4">
          <p className="text-[12px] text-ivory-60">
            Your data stays synced and will be here when you return.
          </p>
          <Button variant="outline" size="md" icon={<IconLogout />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Panel>
    </>
  );
}

/* ══ Building blocks ══════════════════════════════════════════════════════ */

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
      <div className="min-w-0 max-w-[46ch]">
        <p className="text-[13px] text-ivory">{label}</p>
        {hint && <p className="mt-1 text-[11px] leading-relaxed text-ivory-40">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200",
          checked ? "border-signal/60 bg-signal/85" : "border-line-strong bg-ink-750",
          disabled && "pointer-events-none opacity-40",
        )}
      >
        <motion.span
          className={cn(
            "absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full",
            checked ? "bg-ink-1000" : "bg-ivory-60",
          )}
          animate={{ left: checked ? 24 : 3 }}
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
        />
      </button>
    </Row>
  );
}
