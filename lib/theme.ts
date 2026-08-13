/**
 * Theme plumbing.
 *
 * The CSS handles everything drawn by the browser. This file exists for the
 * two things CSS cannot reach: choosing and persisting the mode, and telling
 * canvas what colour to paint with — a `<canvas>` has no cascade, so the chart
 * engine has to read the resolved token values itself.
 */

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "meridian.theme";

export function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersLight() ? "light" : "dark";
  return mode;
}

/** Stamps the resolved theme onto <html>, which is what the CSS keys off. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  // Keeps native form controls, scrollbars and the address bar in step.
  document.documentElement.style.colorScheme = resolved;
}

export function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "dark";
  } catch {
    return "dark";
  }
}

export function storeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* private browsing — the choice simply will not survive a reload */
  }
}

/**
 * Runs before first paint to prevent a flash of the wrong theme.
 *
 * This is inlined into <head> as a blocking script. Everything about that is
 * deliberate: React has not hydrated yet, and a theme applied in an effect
 * means one painted frame in the wrong palette on every single navigation —
 * the single most noticeable flaw a theme switcher can have. Kept tiny and
 * wrapped so a storage exception cannot block rendering.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}")||"dark";var r=m==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):m;var e=document.documentElement;e.setAttribute("data-theme",r);e.style.colorScheme=r;}catch(_){document.documentElement.setAttribute("data-theme","dark");}})();`;

/* ── Reading tokens from canvas ───────────────────────────────────────────── */

let cache: { theme: string; values: Map<string, string> } | null = null;

/**
 * Resolve a CSS custom property to its computed value.
 *
 * Canvas takes colour strings, not variables, so the chart engine reads the
 * tokens once per theme and caches them. Without this the charts would stay
 * dark-palette after a theme switch — the one place the CSS flip cannot reach
 * on its own.
 */
export function themeToken(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;

  const current = document.documentElement.getAttribute("data-theme") ?? "dark";
  if (!cache || cache.theme !== current) {
    cache = { theme: current, values: new Map() };
  }

  const hit = cache.values.get(name);
  if (hit) return hit;

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolved = value || fallback;
  cache.values.set(name, resolved);
  return resolved;
}

/** Drops the cache so the next read re-resolves. Called on a theme change. */
export function invalidateThemeCache(): void {
  cache = null;
}

/** The palette the canvas charts paint with. */
export interface ChartPalette {
  up: string;
  down: string;
  grid: string;
  axis: string;
  text: string;
  textDim: string;
  crosshair: string;
  surface: string;
  pillBg: string;
  pillText: string;
}

/** Dark values, used for server rendering and as the fallback everywhere. */
const DARK_PALETTE: ChartPalette = {
  up: "#3fbf7f",
  down: "#f0563f",
  grid: "rgba(244,242,236,0.055)",
  axis: "rgba(244,242,236,0.11)",
  text: "#c9c6bd",
  textDim: "#6a6862",
  crosshair: "rgba(244,242,236,0.34)",
  surface: "#0b0b0d",
  pillBg: "#1e1e26",
  pillText: "#f4f2ec",
};

export function chartPalette(): ChartPalette {
  // Server render: there is no document to read, and no canvas to paint. The
  // dark values keep the markup deterministic; the client re-resolves on mount
  // and the boot script has already stamped the real theme by then.
  if (typeof document === "undefined") return DARK_PALETTE;

  const light = (document.documentElement.getAttribute("data-theme") ?? "dark") === "light";

  return {
    up: themeToken("--color-up", light ? "#12874c" : "#3fbf7f"),
    down: themeToken("--color-down", light ? "#cf3520" : "#f0563f"),
    // Gridlines and the crosshair are alpha values that have no token of their
    // own; they are derived from the foreground so they follow the theme.
    grid: light ? "rgba(25,24,32,0.075)" : "rgba(244,242,236,0.055)",
    axis: light ? "rgba(25,24,32,0.14)" : "rgba(244,242,236,0.11)",
    text: themeToken("--color-ivory-80", light ? "#3b3947" : "#c9c6bd"),
    textDim: themeToken("--color-ivory-40", light ? "#8b8794" : "#6a6862"),
    crosshair: light ? "rgba(25,24,32,0.42)" : "rgba(244,242,236,0.34)",
    surface: themeToken("--color-ink-900", light ? "#ffffff" : "#0b0b0d"),
    pillBg: themeToken("--color-ink-750", light ? "#e9e5dc" : "#1e1e26"),
    pillText: themeToken("--color-ivory", light ? "#191820" : "#f4f2ec"),
  };
}
