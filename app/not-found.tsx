import Link from "next/link";

import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/primitives";
import { MeridianField } from "@/components/marketing/MeridianField";

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div className="layer -z-10">
        <MeridianField className="h-full w-full opacity-30" />
      </div>
      <div className="layer -z-10 grid-rule opacity-40" aria-hidden />
      <div
        className="layer -z-10 bg-[radial-gradient(60%_50%_at_50%_45%,transparent,var(--color-ink-950)_80%)]"
        aria-hidden
      />

      <Wordmark size={26} />

      <p className="num-mono mt-12 text-[11px] tracking-[0.3em] text-signal">404</p>
      <h1 className="display mt-5 max-w-[16ch] text-[clamp(2rem,5vw,3.4rem)] text-ivory">
        No instrument at this address.
      </h1>
      <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-ivory-60">
        The ticker may be delisted, spelled differently, or outside the universe Meridian
        currently covers. Press{" "}
        <kbd className="rounded-[3px] border border-line px-1.5 py-0.5 text-[11px]">⌘K</kbd> to
        search, or start from the dashboard.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard">
          <Button variant="primary" size="lg">
            Open the terminal
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline" size="lg">
            Back to the front
          </Button>
        </Link>
      </div>
    </div>
  );
}
