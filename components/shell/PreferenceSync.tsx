"use client";

import { useEffect, useRef } from "react";

import { usePersonal } from "@/lib/store/personal";
import { useTheme } from "@/lib/hooks/theme-context";

/**
 * Reconciles synced preferences with the ones the browser applies before
 * React exists.
 *
 * The theme has to be in two places at once. `localStorage` holds it so the
 * boot script in <head> can apply it before the first paint — nothing synced
 * can be read that early. The account holds it so the choice follows you to a
 * new device.
 *
 * This bridges them: once the account's preferences arrive, if they disagree
 * with what the browser booted into, the account wins. That is the correct
 * precedence — the synced value is the one the user set most recently on
 * whichever device they were using.
 *
 * Guarded to run once per load, so it cannot fight a change the user makes in
 * settings a moment later.
 */
export function PreferenceSync() {
  const { preferences, ready } = usePersonal();
  const { mode, setMode } = useTheme();
  const reconciled = useRef(false);

  useEffect(() => {
    if (!ready || reconciled.current) return;
    reconciled.current = true;
    if (preferences.theme && preferences.theme !== mode) {
      setMode(preferences.theme);
    }
  }, [ready, preferences.theme, mode, setMode]);

  // Density is applied as a data attribute so CSS can key off it without every
  // component threading a prop.
  useEffect(() => {
    document.documentElement.setAttribute("data-density", preferences.density);
  }, [preferences.density]);

  // The in-app reduced-motion switch has to reach CSS too, not just Framer.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-motion", preferences.reducedMotion);
  }, [preferences.reducedMotion]);

  return null;
}
