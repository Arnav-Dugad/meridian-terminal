"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyTheme,
  invalidateThemeCache,
  readStoredMode,
  resolveTheme,
  storeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** True once the client has reconciled with storage. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme state.
 *
 * The blocking script in <head> has already stamped the correct theme before
 * this mounts, so there is no flash to correct — this provider only owns
 * *changes* from here on, and keeping the two in sync is why `setMode` writes
 * storage and the attribute together rather than through an effect.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredMode();
    const next = resolveTheme(stored);
    setModeState(stored);
    setResolved(next);
    applyTheme(next);
    invalidateThemeCache();
    setReady(true);
  }, []);

  // Follow the OS while the user is on "system" — someone with a scheduled
  // dark mode expects the app to change at sunset without a reload.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next = resolveTheme("system");
      setResolved(next);
      applyTheme(next);
      invalidateThemeCache();
      // Canvas surfaces cache their palette; tell them to re-read.
      window.dispatchEvent(new CustomEvent("meridian:themechange"));
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    const nextResolved = resolveTheme(next);
    setModeState(next);
    setResolved(nextResolved);
    storeMode(next);
    applyTheme(nextResolved);
    invalidateThemeCache();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("meridian:themechange"));
    }
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, ready }),
    [mode, resolved, setMode, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/**
 * Re-render on a theme change.
 *
 * For components that compute colours in JavaScript rather than CSS —
 * sparklines, the comparison chart — where a class swap is not enough.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener("meridian:themechange", bump);
    return () => window.removeEventListener("meridian:themechange", bump);
  }, []);

  return version;
}
