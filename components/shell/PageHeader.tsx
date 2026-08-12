"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * The masthead every terminal page opens with.
 *
 * Consistent left rail, consistent baseline, consistent place for controls —
 * so moving between sections never costs the reader a moment of reorientation.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Status chips that sit under the title. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "border-b border-line bg-ink-950/60 px-4 py-6 sm:px-6 sm:py-7 lg:px-8",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {eyebrow && <div className="label-micro mb-2.5 text-signal">{eyebrow}</div>}

          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="display text-[clamp(1.7rem,3vw,2.3rem)] text-ivory"
          >
            {title}
          </motion.h1>

          {description && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="mt-2.5 max-w-[68ch] text-[13px] leading-relaxed text-ivory-60"
            >
              {description}
            </motion.p>
          )}

          {meta && <div className="mt-4 flex flex-wrap items-center gap-2.5">{meta}</div>}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Standard page body gutter. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</div>;
}
