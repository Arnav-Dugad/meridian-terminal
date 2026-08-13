"use client";

import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

import { cn } from "@/lib/utils";
import { directionOf, formatPercent, type Direction } from "@/lib/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Panel
   ═══════════════════════════════════════════════════════════════════════════ */

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Removes internal padding — for tables that bleed to the border. */
  flush?: boolean;
}

export function Panel({ children, className, flush = false }: PanelProps) {
  return (
    <section className={cn("panel bevel relative overflow-hidden", !flush && "p-4", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="label-micro text-ivory-80">{title}</h2>
        {subtitle && <p className="mt-1 text-[11px] leading-tight text-ivory-40">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Button
   ═══════════════════════════════════════════════════════════════════════════ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-signal text-ink-1000 hover:bg-signal-soft active:bg-signal font-medium shadow-[0_1px_0_0_rgba(255,255,255,0.18)_inset]",
  secondary:
    "bg-ink-750 text-ivory hover:bg-ink-700 border border-line-strong",
  ghost: "text-ivory-80 hover:text-ivory hover:bg-ink-800",
  danger: "bg-down/12 text-down hover:bg-down/20 border border-down/30",
  outline: "border border-line-strong text-ivory-80 hover:text-ivory hover:border-line-bright",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm",
        "transition-[background-color,border-color,color,opacity,transform] duration-150",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
      aria-hidden
    />
  );
}

/**
 * A button whose surface leans toward the cursor.
 *
 * Displacement is capped at a few pixels and eased through a spring — enough
 * that the control feels attracted to the pointer, not so much that it becomes
 * a moving target. Disabled entirely under reduced-motion.
 */
export function MagneticButton({
  children,
  className,
  strength = 0.28,
  ...props
}: ButtonProps & { strength?: number }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 20, mass: 0.4 });

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (shouldReduceMotion) return;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      x.set(Math.max(-9, Math.min(9, dx * strength)));
      y.set(Math.max(-6, Math.min(6, dy * strength)));
    },
    [shouldReduceMotion, strength, x, y],
  );

  const reset = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return (
    <motion.div style={{ x: sx, y: sy }} className="inline-block">
      <Button ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={className} {...props}>
        {children}
      </Button>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Input
   ═══════════════════════════════════════════════════════════════════════════ */

// `prefix` is a real (deprecated) HTML attribute typed as `string`, so the
// slot props are named for their position instead of shadowing it.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, hint, error, leading, trailing, id, ...props },
  ref,
) {
  const generatedId = useRef(`in_${Math.random().toString(36).slice(2, 9)}`).current;
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="label-micro mb-1.5 block text-ivory-60">
          {label}
        </label>
      )}
      <div
        className={cn(
          "flex items-center gap-2 rounded-sm border bg-ink-850 px-3 transition-colors duration-150",
          "focus-within:border-signal/60 focus-within:bg-ink-800",
          error ? "border-down/55" : "border-line-strong hover:border-line-bright",
        )}
      >
        {leading && <span className="shrink-0 text-ivory-40">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            "h-10 w-full min-w-0 bg-transparent text-[13px] text-ivory outline-none",
            "placeholder:text-ivory-40",
            className,
          )}
          {...props}
        />
        {trailing && <span className="shrink-0 text-ivory-40">{trailing}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-[11px] text-down">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[11px] text-ivory-40">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Delta — the change chip
   ═══════════════════════════════════════════════════════════════════════════ */

export function Delta({
  value,
  absolute,
  size = "md",
  showArrow = true,
  className,
}: {
  value: number;
  /** Optional absolute move shown alongside the percentage. */
  absolute?: string;
  size?: "xs" | "sm" | "md" | "lg";
  showArrow?: boolean;
  className?: string;
}) {
  const dir = directionOf(value);
  const sizes = {
    xs: "text-[10px] px-1 py-px gap-0.5",
    sm: "text-[11px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1",
    lg: "text-sm px-2.5 py-1 gap-1.5",
  } as const;

  return (
    <span
      className={cn(
        "num-mono inline-flex items-center rounded-[3px] font-medium tabular-nums",
        dir === "up" && "bg-up/12 text-up",
        dir === "down" && "bg-down/12 text-down",
        dir === "flat" && "bg-ink-750 text-ivory-60",
        sizes[size],
        className,
      )}
    >
      {showArrow && dir !== "flat" && <Caret direction={dir} />}
      {absolute && <span className="opacity-75">{absolute}</span>}
      {formatPercent(value)}
    </span>
  );
}

function Caret({ direction }: { direction: Direction }) {
  return (
    <svg width="7" height="5" viewBox="0 0 7 5" fill="none" aria-hidden className="shrink-0">
      <path
        d={direction === "up" ? "M3.5 0L7 5H0L3.5 0Z" : "M3.5 5L0 0H7L3.5 5Z"}
        fill="currentColor"
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Segmented control
   ═══════════════════════════════════════════════════════════════════════════ */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
  layoutIdSuffix,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
  /** Keeps the shared-layout indicator unique when several are on one page. */
  layoutIdSuffix?: string;
}) {
  const idRef = useRef(layoutIdSuffix ?? Math.random().toString(36).slice(2, 8));
  const heights = { xs: "h-6", sm: "h-7", md: "h-8" } as const;
  const text = { xs: "text-[10px] px-2", sm: "text-[11px] px-2.5", md: "text-xs px-3" } as const;

  return (
    // A seven-option range picker does not fit a 360px viewport. Rather than
    // shrinking the targets below the point of usability, the strip scrolls —
    // `max-w-full` keeps it from widening its parent, and `scroll-x` hides the
    // scrollbar because on a 28px-tall control it is pure noise.
    <div
      role="tablist"
      className={cn(
        "scroll-x snap-strip inline-flex max-w-full items-center gap-0.5 rounded-sm border border-line bg-ink-900 p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-[3px] font-medium transition-colors duration-150",
              heights[size],
              text[size],
              active ? "text-ink-1000" : "text-ivory-60 hover:text-ivory",
            )}
          >
            {active && (
              // A shared layout id makes the highlight slide between options
              // rather than cross-fade — the single detail that makes a
              // segmented control feel native.
              <motion.span
                layoutId={`segmented-${idRef.current}`}
                className="absolute inset-0 rounded-[3px] bg-signal"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Badge / status
   ═══════════════════════════════════════════════════════════════════════════ */

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "signal" | "up" | "down" | "india" | "usa" | "crypto";
  className?: string;
}) {
  const tones = {
    neutral: "border-line-strong text-ivory-60",
    signal: "border-signal/35 text-signal bg-signal/8",
    up: "border-up/35 text-up bg-up/8",
    down: "border-down/35 text-down bg-down/8",
    india: "border-india/35 text-india bg-india/8",
    usa: "border-usa/35 text-usa bg-usa/8",
    crypto: "border-crypto/35 text-crypto bg-crypto/8",
  } as const;

  return (
    <span
      className={cn(
        "label-micro-tight inline-flex items-center rounded-[3px] border px-1.5 py-[3px]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A pulsing dot. `live` gives it the halo; otherwise it sits still. */
export function StatusDot({
  tone = "neutral",
  live = false,
  className,
}: {
  tone?: "up" | "down" | "signal" | "neutral" | "usa";
  live?: boolean;
  className?: string;
}) {
  const colors = {
    up: "bg-up",
    down: "bg-down",
    signal: "bg-signal",
    usa: "bg-usa",
    neutral: "bg-ivory-40",
  } as const;

  return (
    <span className={cn("relative inline-flex h-1.5 w-1.5 shrink-0", className)}>
      {live && (
        <span
          className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-70", colors[tone])}
        />
      )}
      <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", colors[tone])} />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Skeleton
   ═══════════════════════════════════════════════════════════════════════════ */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-[3px] bg-ink-800", className)} style={style}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2.4s_var(--ease-swift)_infinite] bg-gradient-to-r from-transparent via-ivory/[0.045] to-transparent" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tooltip
   ═══════════════════════════════════════════════════════════════════════════ */

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <motion.span
          initial={{ opacity: 0, y: side === "top" ? 3 : -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 w-max max-w-[220px] -translate-x-1/2 rounded-sm",
            "border border-line-strong bg-ink-800 px-2 py-1.5 text-[11px] leading-snug text-ivory-80 shadow-lg",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {content}
        </motion.span>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scroll reveal
   ═══════════════════════════════════════════════════════════════════════════ */

export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-12% 0px -8% 0px" }}
      transition={{ duration: 0.72, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Empty state used by every list surface, so they all read the same. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ivory-40">{icon}</div>}
      <p className="text-sm text-ivory-80">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-ivory-40">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
