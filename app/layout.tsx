import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Instrument_Serif } from "next/font/google";

import "./globals.css";
import { Providers } from "@/app/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * Three families, each doing one job.
 *
 * Inter carries the interface. Instrument Serif carries display type — a
 * high-contrast editorial face that signals financial press rather than SaaS
 * dashboard, and the single strongest cue that a human chose the typography.
 * IBM Plex Mono carries every figure: it was drawn for data, its zero is
 * slashed, and its tabular widths keep price columns from shifting as digits
 * change.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  axes: ["opsz"],
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const SITE = "https://meridian-terminal.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Meridian — Cross-market intelligence for India and the United States",
    template: "%s · Meridian",
  },
  description:
    "A trading terminal built around one idea: India and the United States are one market separated by ten and a half hours. Live NSE, BSE, Nasdaq and NYSE data, cross-market correlation, portfolio analytics and price alerts.",
  keywords: [
    "NSE", "BSE", "Nifty 50", "Sensex", "Nasdaq", "NYSE", "S&P 500",
    "Indian stock market", "US stock market", "stock screener", "portfolio tracker",
    "market correlation", "trading terminal",
  ],
  authors: [{ name: "Meridian" }],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: SITE,
    siteName: "Meridian",
    title: "Meridian — Cross-market intelligence for India and the United States",
    description:
      "Live NSE, BSE, Nasdaq and NYSE data in one terminal. Cross-market correlation, portfolio analytics, screener and alerts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Meridian — Cross-market intelligence",
    description: "One terminal for the Indian and United States equity markets.",
  },
  robots: { index: true, follow: true },
  category: "finance",
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrument.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the stored theme before the first paint. An effect would run
          after hydration, which means one frame in the wrong palette on every
          navigation — the most conspicuous flaw a theme switcher can have.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="grain-fixed min-h-dvh bg-ink-950 text-ivory antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:bg-signal focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-ink-1000"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
