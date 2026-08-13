import Link from "next/link";

import { getQuotes, getSeries } from "@/lib/twelvedata/service";
import { DEFAULT_WATCHLIST, INDICES } from "@/lib/market/universe";
import type { Quote } from "@/lib/twelvedata/types";

import { LandingNav } from "@/components/marketing/LandingNav";
import { MeridianField } from "@/components/marketing/MeridianField";
import { IndexStrip, type IndexSeed } from "@/components/market/IndexStrip";
import { SessionDial } from "@/components/market/SessionDial";
import { Tape } from "@/components/market/Tape";
import { Reveal, Badge, Button } from "@/components/ui/primitives";
import { CountUp } from "@/components/ui/AnimatedNumber";
import { Wordmark, Glyph } from "@/components/brand/Wordmark";
import {
  IconArrowRight,
  IconBell,
  IconBriefcase,
  IconChart,
  IconCommand,
  IconFilter,
  IconGlobe,
  IconScale,
} from "@/components/ui/icons";
import { DataSourceNotice } from "@/components/market/DataSourceNotice";

/**
 * The marketing page renders from the same service layer the terminal uses, so
 * the figures above the fold are the real ones rather than a screenshot. ISR
 * at a minute keeps that honest without putting a provider call on every
 * visit.
 */
export const revalidate = 60;

const HERO_INDICES = ["NIFTY50", "SENSEX", "SPX", "IXIC"];

export default async function LandingPage() {
  const [quoteRes, ...seriesRes] = await Promise.all([
    getQuotes(HERO_INDICES),
    ...HERO_INDICES.map((slug) => getSeries(slug, "1M")),
  ]);

  const quoteBySlug = new Map<string, Quote>(quoteRes.data.map((q) => [q.slug, q]));

  const seeds: IndexSeed[] = HERO_INDICES.flatMap((slug, i) => {
    const quote = quoteBySlug.get(slug);
    if (!quote) return [];
    const candles = seriesRes[i]?.data.candles ?? [];
    return [{ slug, quote, spark: candles.map((c) => c.c) }];
  });

  return (
    <>
      <LandingNav />

      <main id="main" className="relative">
        {/* ══ Hero ══════════════════════════════════════════════════════════ */}
        <section className="relative isolate min-h-[92svh] overflow-hidden pt-16">
          <div className="layer -z-10">
            <MeridianField className="h-full w-full opacity-[0.55]" />
          </div>
          {/* Graph-paper substrate, faded out toward the edges. */}
          <div className="layer -z-10 grid-rule mask-fade-b opacity-[0.55]" aria-hidden />
          <div
            className="layer -z-10 bg-[radial-gradient(75%_55%_at_50%_0%,transparent_0%,var(--color-ink-950)_88%)]"
            aria-hidden
          />

          <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-20 sm:px-8 sm:pt-28">
            <Reveal>
              <div className="flex items-center gap-2.5">
                <Badge tone="signal">
                  <span className="mr-1.5 inline-block h-1 w-1 animate-breathe rounded-full bg-signal align-middle" />
                  NSE · BSE · NASDAQ · NYSE
                </Badge>
                <DataSourceNotice source={quoteRes.source} notice={quoteRes.notice} />
              </div>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="display mt-7 max-w-[19ch] text-[clamp(2.9rem,7.4vw,6.1rem)] text-ivory">
                Two markets.
                <br />
                <span className="italic text-signal">Ten and a half</span> hours
                <br />
                apart.
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-7 max-w-[54ch] text-pretty text-[15px] leading-relaxed text-ivory-80 sm:text-base">
                Bengaluru closes at 15:30. New York opens at 09:30, five and a half hours
                later and half a world west. Meridian is a terminal built for the people
                who trade across that seam — live quotes, cross-market correlation,
                portfolio analytics and alerts, in one surface that speaks both rupees
                and dollars natively.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/signup">
                  <Button variant="primary" size="lg" icon={<IconArrowRight />}>
                    Open the terminal
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="outline" size="lg">
                    Explore without an account
                  </Button>
                </Link>
                <p className="flex items-center gap-1.5 text-[12px] text-ivory-40">
                  <IconCommand className="h-3.5 w-3.5" />
                  Press <kbd className="rounded-[3px] border border-line px-1 py-px text-[10px]">⌘K</kbd>{" "}
                  anywhere
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.26}>
              <div className="mt-16">
                <IndexStrip seeds={seeds} columns={4} className="sm:grid-cols-4 grid-cols-2" />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ══ Tape ══════════════════════════════════════════════════════════ */}
        <section className="border-y border-line bg-ink-900/60" aria-label="Live prices">
          <Tape symbols={DEFAULT_WATCHLIST} showExchange />
        </section>

        {/* ══ Thesis ════════════════════════════════════════════════════════ */}
        <section id="thesis" className="relative border-b border-line py-24 sm:py-32">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-14 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
              <div>
                <Reveal>
                  <p className="label-micro text-signal">The thesis</p>
                  <h2 className="display mt-5 max-w-[16ch] text-[clamp(2rem,4.4vw,3.4rem)] text-ivory">
                    One market, running in shifts.
                  </h2>
                </Reveal>

                <Reveal delay={0.08}>
                  <div className="mt-8 max-w-[58ch] space-y-5 text-[14px] leading-relaxed text-ivory-80">
                    <p>
                      An Indian IT major reports, and the read-across lands on a US
                      software name that will not trade for another four hours. A
                      semiconductor cycle turns in Santa Clara and shows up in Chennai
                      the next morning. Traders on both sides already know this. The
                      tooling has not caught up.
                    </p>
                    <p>
                      Most terminals treat India as a footnote and price everything in
                      dollars, or treat the US as an afterthought and quote it in a
                      currency nobody trades it in. Meridian refuses the choice.
                      Market cap in an NSE listing reads in crore; the same panel on a
                      Nasdaq listing reads in billions. Digit grouping follows the
                      market, not the browser locale.
                    </p>
                    <p>
                      Underneath sits a correlation engine that answers the question
                      the split actually raises:{" "}
                      <span className="text-ivory">
                        when this moves, what moves with it, and how much of that is
                        just beta to the index?
                      </span>
                    </p>
                  </div>
                </Reveal>

                <Reveal delay={0.14}>
                  <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-7 border-t border-line pt-8 sm:grid-cols-4">
                    <Stat value={131} suffix="" label="Instruments tracked" />
                    <Stat value={4} suffix="" label="Exchanges" />
                    <Stat value={7} suffix="" label="Chart ranges" />
                    <Stat value={12} suffix="" label="Indicators" />
                  </dl>
                </Reveal>
              </div>

              <Reveal delay={0.1} className="lg:pt-14">
                <div className="panel bevel p-6">
                  <p className="label-micro mb-6 text-ivory-60">Sessions, in your local time</p>
                  <SessionDial />
                  <p className="mt-7 border-t border-line pt-5 text-[12px] leading-relaxed text-ivory-40">
                    Session state is computed from the exchange's own clock rather than
                    polled, so the countdown stays smooth and stays correct through
                    daylight-saving transitions on the US side.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ══ Capabilities ══════════════════════════════════════════════════ */}
        <section id="terminal" className="border-b border-line py-24 sm:py-32">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <Reveal>
              <p className="label-micro text-signal">The terminal</p>
              <h2 className="display mt-5 max-w-[18ch] text-[clamp(2rem,4.4vw,3.4rem)] text-ivory">
                Built to be lived in, not toured.
              </h2>
            </Reveal>

            <div className="mt-14 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap, i) => (
                <Capability key={cap.title} {...cap} index={i} />
              ))}
            </div>
          </div>
        </section>

        {/* ══ India, properly ═══════════════════════════════════════════════ */}
        <section id="india" className="border-b border-line py-24 sm:py-32">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
              <Reveal>
                <p className="label-micro text-signal">Built for India too</p>
                <h2 className="display mt-5 text-[clamp(2rem,4.4vw,3.4rem)] text-ivory">
                  Not a footnote on someone else's terminal.
                </h2>
                <p className="mt-7 max-w-[46ch] text-[14px] leading-relaxed text-ivory-80">
                  Most tools bolt India on: dollar prices, Western digit grouping, and no
                  sense of what actually moves the Nifty. Meridian starts from the other
                  end.
                </p>
              </Reveal>

              <div className="space-y-px overflow-hidden rounded-md border border-line bg-line">
                {INDIA_POINTS.map((item, i) => (
                  <Reveal key={item.title} delay={0.05 * i}>
                    <div className="bg-ink-900 p-6">
                      <div className="flex items-baseline gap-3">
                        <span className="num-mono text-[11px] text-signal">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <h3 className="text-[14px] font-medium text-ivory">{item.title}</h3>
                      </div>
                      <p className="mt-2.5 pl-[30px] text-[13px] leading-relaxed text-ivory-60">
                        {item.body}
                      </p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══ CTA ═══════════════════════════════════════════════════════════ */}
        <section className="relative isolate overflow-hidden py-28 sm:py-36">
          <div className="layer -z-10 grid-rule-fine opacity-70" aria-hidden />
          <div
            className="layer -z-10 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(240,166,60,0.07)_0%,transparent_70%)]"
            aria-hidden
          />

          <div className="mx-auto max-w-[1240px] px-5 text-center sm:px-8">
            <Reveal>
              <Glyph size={38} className="mx-auto text-ivory-60" />
              <h2 className="display mx-auto mt-8 max-w-[16ch] text-[clamp(2.2rem,5vw,4rem)] text-ivory">
                Trade the whole clock.
              </h2>
              <p className="mx-auto mt-6 max-w-[46ch] text-[15px] leading-relaxed text-ivory-60">
                Free to open. Your watchlist, portfolio and alerts sync across devices
                the moment you sign in — and work locally before you do.
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link href="/signup">
                  <Button variant="primary" size="lg" icon={<IconArrowRight />}>
                    Create your account
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="outline" size="lg">
                    Look around first
                  </Button>
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ══ Footer ════════════════════════════════════════════════════════ */}
        <footer className="border-t border-line bg-ink-1000">
          <div className="mx-auto max-w-[1240px] px-5 py-14 sm:px-8">
            <div className="flex flex-col justify-between gap-10 sm:flex-row">
              <div className="max-w-[34ch]">
                <Wordmark />
                <p className="mt-4 text-[12px] leading-relaxed text-ivory-40">
                  Cross-market intelligence for the Indian and United States equity
                  markets. Market data by Twelve Data. Accounts and sync by Firebase.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-12 gap-y-6 sm:gap-x-16">
                <FooterColumn
                  title="Terminal"
                  links={[
                    { href: "/dashboard", label: "Dashboard" },
                    { href: "/markets", label: "Markets" },
                    { href: "/screener", label: "Screener" },
                    { href: "/compare", label: "Compare" },
                  ]}
                />
                <FooterColumn
                  title="Account"
                  links={[
                    { href: "/watchlist", label: "Watchlist" },
                    { href: "/portfolio", label: "Portfolio" },
                    { href: "/alerts", label: "Alerts" },
                    { href: "/login", label: "Sign in" },
                  ]}
                />
              </div>
            </div>

            <div className="mt-12 flex flex-col gap-4 border-t border-line pt-7 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-ivory-40">
                © {new Date().getFullYear()} Meridian. Built for research and education.
              </p>
              <p className="max-w-[62ch] text-[11px] leading-relaxed text-ivory-40">
                Nothing here is investment advice. Quotes may be delayed depending on
                your data plan, and figures shown while the provider is unreachable are
                labelled as simulated.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

/* ── Page-local pieces ────────────────────────────────────────────────────── */

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div>
      <dd className="num-mono text-[28px] leading-none tracking-tight text-ivory">
        <CountUp to={value} suffix={suffix} />
      </dd>
      <dt className="label-micro mt-2.5 text-ivory-40">{label}</dt>
    </div>
  );
}

const CAPABILITIES = [
  {
    icon: <IconChart />,
    title: "A chart that morphs",
    body: "Switching range deforms the existing curve into the new one instead of redrawing it. Candles, area, six overlays, and a crosshair that snaps to the bar rather than the pixel.",
  },
  {
    icon: <IconScale />,
    title: "Cross-market correlation",
    body: "Rebase any set of instruments to 100 and read them on one axis. Pearson correlation and beta against either index, computed in the browser from the bars already on screen.",
  },
  {
    icon: <IconFilter />,
    title: "A screener that spans both",
    body: "Filter NSE and US listings together on change, range position, volume and sector — then sort by any column without a round trip.",
  },
  {
    icon: <IconBriefcase />,
    title: "Portfolio in your currency",
    body: "Hold rupee and dollar positions in one book. Totals convert at the live rate, with per-position P&L, weight, and contribution to the day's move.",
  },
  {
    icon: <IconBell />,
    title: "Alerts that watch for you",
    body: "Absolute levels or percentage moves from where you set them. Evaluated against the live stream in the tab, with a browser notification when one fires.",
  },
  {
    icon: <IconGlobe />,
    title: "Session-aware everything",
    body: "Every surface knows which exchange is trading. Polling backs off overnight, breadth reads against the right session, and the dial shows both in your own time.",
  },
];

function Capability({
  icon,
  title,
  body,
  index,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  index: number;
}) {
  return (
    <Reveal delay={0.04 * index}>
      <div className="group h-full bg-ink-900 p-7 transition-colors duration-300 hover:bg-ink-850">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-ink-850 text-ivory-60 transition-colors duration-300 group-hover:border-signal/40 group-hover:text-signal">
          {icon}
        </span>
        <h3 className="mt-5 text-[14px] font-medium text-ivory">{title}</h3>
        <p className="mt-2.5 text-[13px] leading-relaxed text-ivory-60">{body}</p>
      </div>
    </Reveal>
  );
}

const INDIA_POINTS = [
  {
    title: "Rupees read like rupees",
    body: "Market cap on an NSE listing shows in crore, grouped 2,32,10,000 the way you actually write it. The same panel on a Nasdaq listing shows billions. Neither market is translated into the other's units.",
  },
  {
    title: "Institutional flows, every session",
    body: "How much foreign and domestic institutions bought and sold — the number that explains more Nifty movement than any indicator. Almost no consumer terminal surfaces it; here it has its own page, with history that builds as you use it.",
  },
  {
    title: "The gap between the two closes",
    body: "Mumbai shuts at 15:30. New York opens five and a half hours later. Meridian shows you what happened in between, and which of your Indian holdings historically move with the US names that are about to trade.",
  },
  {
    title: "One book, two currencies",
    body: "Hold Reliance and Nvidia side by side. Totals convert at the live rate, so you can see exactly how much of your return came from the market and how much came from the rupee.",
  },
];

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="label-micro text-ivory-40">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-[13px] text-ivory-60 transition-colors duration-150 hover:text-ivory"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
