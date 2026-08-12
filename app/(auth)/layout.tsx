import Link from "next/link";

import { MeridianField } from "@/components/marketing/MeridianField";
import { Wordmark } from "@/components/brand/Wordmark";
import { SessionDial } from "@/components/market/SessionDial";
import { Tape } from "@/components/market/Tape";
import { DEFAULT_WATCHLIST } from "@/lib/market/universe";

/**
 * Auth shell.
 *
 * A split layout: the form on the left, and on the right the product actually
 * running. Showing a live tape and a real session dial next to a sign-up form
 * is a stronger argument than any illustration, and it costs nothing extra —
 * both components are already subscribed to the shared quote store.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── Form side ─────────────────────────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col px-5 py-8 sm:px-10 lg:px-14">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="Meridian home">
            <Wordmark />
          </Link>
          <Link
            href="/dashboard"
            className="text-[12px] text-ivory-40 transition-colors hover:text-ivory-80"
          >
            Continue without an account →
          </Link>
        </header>

        <main id="main" className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-[380px]">{children}</div>
        </main>

        <footer className="text-[11px] leading-relaxed text-ivory-40">
          By continuing you agree that Meridian is a research tool and that nothing it
          shows is investment advice.
        </footer>
      </div>

      {/* ── Product side ──────────────────────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden border-l border-line bg-ink-1000 lg:flex lg:flex-col">
        <div className="layer -z-10">
          <MeridianField className="h-full w-full opacity-40" />
        </div>
        <div className="layer -z-10 grid-rule opacity-40" aria-hidden />
        <div
          className="layer -z-10 bg-[radial-gradient(70%_50%_at_70%_10%,transparent,var(--color-ink-1000)_85%)]"
          aria-hidden
        />

        <div className="flex flex-1 flex-col justify-center px-14">
          <p className="label-micro text-signal">Meridian</p>
          <h2 className="display mt-5 max-w-[15ch] text-[clamp(2rem,3vw,2.9rem)] text-ivory">
            Both markets, one clock.
          </h2>
          <p className="mt-6 max-w-[42ch] text-[14px] leading-relaxed text-ivory-60">
            Your watchlist, portfolio and alerts follow you across devices the moment
            you sign in — and anything you set up beforehand comes with you.
          </p>

          <div className="panel bevel mt-10 max-w-[440px] p-6">
            <SessionDial />
          </div>
        </div>

        <div className="border-t border-line bg-ink-950/70">
          <Tape symbols={DEFAULT_WATCHLIST} speed={1.3} />
        </div>
      </aside>
    </div>
  );
}
