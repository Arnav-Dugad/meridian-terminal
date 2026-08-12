"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/primitives";
import { IconRefresh } from "@/components/ui/icons";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In production this is where a reporter (Sentry, Axiom) would receive the
    // error. Logging keeps the digest visible in the platform's function logs,
    // which is what makes a production report actionable.
    console.error("[meridian] unhandled error", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark size={26} />

      <p className="label-micro mt-12 text-down">Something broke</p>
      <h1 className="display mt-5 max-w-[18ch] text-[clamp(1.8rem,4vw,2.8rem)] text-ivory">
        The terminal hit an error it couldn't recover from.
      </h1>
      <p className="mt-5 max-w-[48ch] text-[14px] leading-relaxed text-ivory-60">
        Your watchlist, portfolio and alerts are stored separately and are unaffected.
        Retrying usually clears it — market data providers occasionally return something
        unexpected.
      </p>

      {error.digest && (
        <p className="num-mono mt-6 rounded-sm border border-line bg-ink-900 px-3 py-2 text-[11px] text-ivory-40">
          Reference: {error.digest}
        </p>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" size="lg" icon={<IconRefresh />} onClick={reset}>
          Try again
        </Button>
        <Link href="/dashboard">
          <Button variant="outline" size="lg">
            Back to the dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
