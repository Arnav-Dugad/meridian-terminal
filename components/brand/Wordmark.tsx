import { cn } from "@/lib/utils";

/**
 * The mark: a meridian line crossing a circle, with the arc thickening where
 * the two sessions overlap. Drawn rather than lettered so it reads at 16px in
 * a favicon and at 96px on a title card without a second asset.
 */
export function Glyph({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.3" />
      {/* East arc — India. */}
      <path
        d="M12 2.8A9.2 9.2 0 0 1 12 21.2"
        stroke="#f0a63c"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      {/* West arc — United States. */}
      <path
        d="M12 21.2A9.2 9.2 0 0 1 12 2.8"
        stroke="#7ba7f0"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      {/* The meridian itself. */}
      <path d="M12 1.4v21.2" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.55" />
    </svg>
  );
}

export function Wordmark({
  className,
  size = 20,
  showText = true,
}: {
  className?: string;
  size?: number;
  showText?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 text-ivory", className)}>
      <Glyph size={size} />
      {showText && (
        <span className="text-[15px] font-medium tracking-[-0.01em] text-ivory">
          Meridian
        </span>
      )}
    </span>
  );
}
