"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  format: (v: number) => string;
  className?: string;
  /** Flash the cell green or red on change, the way a trading blotter does. */
  flash?: boolean;
  /** Spring feel. `taut` for prices, `soft` for aggregates. */
  feel?: "taut" | "soft";
}

/**
 * A number that moves rather than jumps.
 *
 * Two things here matter more than they sound. First, the value is driven by a
 * spring, so a price walking up 12 paise reads as motion in a direction rather
 * than a redraw — over a dashboard of forty rows that is the difference
 * between "live" and "refreshing". Second, the change flash is keyed on the
 * direction of the delta and decays on its own, which is the convention every
 * professional blotter uses and which lets a reader catch movement in
 * peripheral vision without watching any single row.
 *
 * Tabular figures come from the global font settings, so the width never
 * jitters as digits change.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  flash = false,
  feel = "taut",
}: AnimatedNumberProps) {
  const shouldReduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const spring = useSpring(
    motionValue,
    feel === "taut"
      ? { stiffness: 220, damping: 30, mass: 0.55 }
      : { stiffness: 90, damping: 24, mass: 0.9 },
  );
  const display = useTransform(spring, (v) => format(v));

  const previous = useRef(value);
  const [pulse, setPulse] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const prev = previous.current;
    previous.current = value;
    if (!flash || prev === value || !Number.isFinite(prev)) return;

    setPulse(value > prev ? "up" : "down");
    const timer = setTimeout(() => setPulse(null), 850);
    return () => clearTimeout(timer);
  }, [value, flash]);

  if (shouldReduceMotion) {
    return <span className={className}>{format(value)}</span>;
  }

  return (
    <span
      className={cn(
        "relative inline-block rounded-[3px] px-[3px] -mx-[3px]",
        pulse === "up" && "tick-up",
        pulse === "down" && "tick-down",
        className,
      )}
    >
      <motion.span>{display}</motion.span>
    </span>
  );
}

/**
 * Counts up from zero once, when scrolled into view. Used for the statistics
 * on the marketing page, where the point is the arrival, not live tracking.
 *
 * Formatting is declared with `decimals`/`prefix`/`suffix` rather than a
 * callback so this can be rendered directly from a server component — function
 * props cannot cross that boundary.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  duration = 1.5,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const value = useMotionValue(0);
  const display = useTransform(
    value,
    (v) =>
      `${prefix}${v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`,
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || started) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    if (shouldReduceMotion) {
      value.set(to);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // Expo-out: most of the distance is covered early, then it settles.
      value.set(to * (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, to, duration, value, shouldReduceMotion]);

  return (
    <span ref={ref} className={className}>
      <motion.span>{display}</motion.span>
    </span>
  );
}
