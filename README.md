# Meridian

**Cross-market intelligence for the Indian and United States equity markets.**

Bengaluru closes at 15:30 IST. New York opens at 09:30 ET — five and a half hours later
and half a world west. Meridian is a trading terminal built for the seam between them:
live NSE, BSE, Nasdaq and NYSE data in one surface that speaks rupees and dollars
natively, with cross-market correlation, portfolio analytics and price alerts.

Market data by [Twelve Data](https://twelvedata.com). Accounts and sync by Firebase.

---

## Contents

- [What's in it](#whats-in-it)
- [Running it locally](#running-it-locally)
- [Configuration](#configuration)
  - [Twelve Data](#twelve-data)
  - [Firebase](#firebase)
- [Deploying to Vercel](#deploying-to-vercel)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Design system](#design-system)
- [Known limits](#known-limits)

---

## What's in it

**Eight working surfaces.**

| Route | What it does |
| --- | --- |
| `/` | Marketing page, rendering live index data from the same service layer the terminal uses |
| `/dashboard` | Cross-market overview — indices, breadth, sector rotation, movers, India-minus-US spread |
| `/markets` | Indices, participation and sector rotation with both markets on one shared scale |
| `/stock/[slug]` | Chart, technical read, risk statistics, cross-market correlation, company profile |
| `/screener` | Filter NSE and US listings together on direction, session position, sector and magnitude |
| `/compare` | Rebase up to six instruments to 100, with a pairwise correlation matrix |
| `/watchlist` | Live tracked instruments, sortable, with a list-level summary |
| `/portfolio` | Rupee and dollar positions in one book, converted at the live rate |
| `/alerts` | Price triggers evaluated against the live stream |

**Some things worth pointing at specifically:**

- **A charting engine written from scratch** (`components/chart/engine.ts`). Range switches
  *morph* — the outgoing series is resampled onto the incoming one's index space and
  interpolated, so 1M → 1Y is a continuous deformation rather than a redraw. The render
  loop is demand-driven and parks when idle, which is what makes several charts on one
  page viable. Every stroke is snapped to the physical pixel grid.
- **A command palette** (`⌘K` / `Ctrl-K`, or `/`) that searches the instrument universe and
  the navigation graph in one ranked list, with a subsequence matcher so `hdfcb` finds
  HDFCBANK.
- **A 24-hour session dial** plotting both trading sessions against *your* local clock —
  the product thesis rendered as geometry.
- **Indian number formatting throughout.** Market cap on an NSE listing reads in crore with
  2,32,10,000-style grouping; the same panel on a Nasdaq listing reads in billions.
- **A correlated simulation layer** so the whole product is explorable before you add a
  single API key — and labelled as simulated everywhere it appears.

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev
```

Open <http://localhost:3000>.

**It works with no configuration at all.** With no Twelve Data key, prices come from a
three-factor simulation; with no Firebase project, watchlists, positions and alerts
persist to `localStorage`. Every surface is fully functional either way, and anything not
sourced from a live provider carries a `Simulated` or `Cached` badge.

Other scripts:

```bash
npm run build      # production build
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
```

`GET /api/health` reports which providers are configured, current credit usage and cache
occupancy. It reports presence only — never a key, an email or a project id — so it is
safe to leave public and point an uptime monitor at.

---

## Configuration

Everything is optional. Add what you have.

### Twelve Data

Get a key at <https://twelvedata.com/account/api-keys>.

```bash
TWELVE_DATA_API_KEY=your_key_here
TWELVE_DATA_CREDITS_PER_MINUTE=8     # your plan's limit; free tier is 8
```

`TWELVE_DATA_CREDITS_PER_MINUTE` is not decoration — it sizes the server-side credit
governor. Set it to your actual plan limit. A batch quote for twenty symbols costs twenty
credits, not one, and getting this number wrong means either wasted headroom or a stream
of 429s.

The key is server-only and is deliberately **not** prefixed `NEXT_PUBLIC_`. All market
data is proxied through `/api/*` route handlers; `lib/twelvedata/client.ts` imports
`server-only`, so an accidental import from a client component is a build error rather
than a leaked key.

### Firebase

Create a project at <https://console.firebase.google.com>, then:

1. **Authentication → Sign-in method** — enable **Email/Password** and **Google**.
2. **Firestore Database** — create a database in production mode.
3. **Project settings → Your apps → Web** — copy the config into the `NEXT_PUBLIC_*` vars.
4. **Project settings → Service accounts → Generate new private key** — for the server vars.

```bash
# Client SDK — public by design; Firestore rules are what protect data
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Admin SDK — server only, used to mint httpOnly session cookies
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> **The private key is the step that trips people up.** Environment files cannot hold real
> newlines, so paste it with literal `\n` escapes inside double quotes. Alternatively drop
> the entire service-account JSON — raw or base64-encoded — into `FIREBASE_SERVICE_ACCOUNT`
> and leave the three discrete vars blank. Both forms are handled.

**Deploy the security rules.** `firestore.rules` is in the repo:

```bash
firebase deploy --only firestore:rules
```

…or paste it into **Firestore → Rules**. The data model is one document per user under
`users/{uid}`; the rules enforce ownership, cap collection sizes so a compromised client
cannot write unbounded blobs into a document read on every page load, and default-deny
everything else.

If you deploy to a custom domain, add it under **Authentication → Settings → Authorized
domains**, or Google sign-in will fail with `auth/unauthorized-domain`.

---

## Deploying to Vercel

1. Import the repository at <https://vercel.com/new>. Next.js is detected automatically —
   no build settings to change.
2. Add the environment variables above under **Settings → Environment Variables**.
3. Deploy.

Two notes specific to this app:

- **`maxDuration` on the SSE route.** `/api/stream` holds a connection for ~52 seconds and
  then closes cleanly; `EventSource` reconnects on its own, so the client never sees a gap.
  This keeps it inside serverless execution limits. On a platform with long-lived
  connections you can raise `STREAM_MS` and `maxDuration` in `app/api/stream/route.ts`.
- **Cache scope.** The request cache is process-local, which on Vercel means one warm
  instance. That is intentional — the expensive resource is the credit budget, and the hot
  path (a dashboard polling twenty tickers) is served by whichever instance the connection
  landed on. If you want a shared cache across instances, `lib/twelvedata/cache.ts` is the
  single seam to swap for Redis.

---

## Architecture

### The constraint that shapes everything

A market-data plan bills **per symbol per request**. That single fact determines what gets
cached, for how long, what degrades, and what is computed locally instead of bought.

**Single-flight cache with stale-while-revalidate** — `lib/twelvedata/cache.ts`
Twenty components asking for RELIANCE at once produce one upstream call. Past its TTL the
cached value is still served while a refresh runs behind the request, so a slow provider
never blocks a render. Past a hard ceiling, stale data is refused outright — a
nine-minute-old quote presented as current is worse than no quote.

**A credit budget, not a retry loop** — `lib/twelvedata/limiter.ts`
Requests take a ticket against a sliding one-minute window sized to your plan. If the wait
exceeds what a serverless invocation should hold open, the caller degrades to cache or
simulation rather than stalling. Acquisitions are serialised through a promise chain so two
concurrent callers cannot both observe the same free slot and overspend the window.

**Graceful degradation, labelled** — `lib/twelvedata/service.ts`
Every read resolves to `live`, `cached` or `simulated`, and that provenance is propagated
all the way to a badge in the UI. The app will happily show simulated prices during an
outage, which is only defensible because it says so.

**One stream for the whole app** — `lib/hooks/market-data.tsx`
Components declare the symbols they need; a reference-counted subscription set drives a
single server-sent-events connection. Subscription changes are debounced, because rendering
a forty-row table mounts forty subscribers in one frame. Only changed prices go over the
wire. A blocked stream falls back to interval polling rather than freezing.

**Indicators computed locally** — `lib/analytics/indicators.ts`
RSI, MACD, Bollinger, ATR, VWAP, OBV, correlation, beta, Sharpe, Sortino and drawdown are
pure functions of bars already downloaded. Buying them per-symbol per-indicator would put a
network round trip between the user and a slider they are dragging. Every returned series
is aligned to the input length with `null` in the warm-up region, so overlays can never
render one bar off.

**Sessions from an httpOnly cookie** — `lib/firebase/admin.ts`, `app/api/session/route.ts`
The Firebase ID token is exchanged server-side for a cookie JavaScript cannot read. That is
what lets authenticated pages render on the server with no unauthenticated flash, and it
removes the exfiltration path that storing tokens in `localStorage` would open.
`onIdTokenChanged` (not `onAuthStateChanged`) keeps the cookie alive across the hourly
silent refresh.

**Personal data with two backends** — `lib/store/personal.tsx`
Signed in, it is a single Firestore document with a live listener — an edit on a phone
lands on a desktop tab in a few hundred milliseconds. Otherwise it is `localStorage`. The
interface is identical, so no component knows or cares, and work done as a guest is lifted
into the account on first sign-in rather than discarded. One document rather than
subcollections: a personal book is tens of rows, so one read, one listener and atomic
writes beat N reads and a fan-out.

**Session state computed, not polled** — `lib/market/exchanges.ts`
Whether a market is open is a pure function of the wall clock. Spending a credit every few
seconds to learn it would be wasteful, and the answer has to be correct on the client
anyway for the countdown to tick smoothly. DST on the US side is handled by reading
`Intl.DateTimeFormat` parts rather than by hardcoded offsets.

---

## Project layout

```
app/
  (auth)/                 login + signup, split layout with the live product alongside
  (app)/                  the terminal shell — rail, topbar, tape, alert watcher
    dashboard/ markets/ screener/ compare/
    watchlist/ portfolio/ alerts/ stock/[slug]/
  api/
    quotes/ series/ overview/ search/ profile/ fx/     market data
    stream/                                            server-sent events
    session/                                           Firebase session cookie
    health/                                            ops snapshot
  page.tsx                marketing page
  globals.css             design tokens

components/
  chart/                  engine.ts, PriceChart, ComparisonChart, Sparkline
  market/                 QuoteTable, SessionDial, Tape, BreadthMeter, SectorRotation, …
  shell/                  AppShell, CommandPalette, AlertWatcher, PageHeader
  ui/                     primitives, AnimatedNumber, icons
  views/                  one per route — all the page-level composition
  marketing/ brand/ auth/

lib/
  twelvedata/             client, cache, limiter, service, overview, simulate, types
  analytics/              indicators, portfolio
  market/                 exchanges, universe, timezone
  firebase/               client, admin, auth-context
  store/                  personal, types
  hooks/                  market-data, use-series
  format.ts utils.ts

firestore.rules
```

---

## Design system

Dark by commitment, not by default — this is a terminal, and one palette lets the data
carry the colour.

- **Ground.** Warm-shifted blacks. Pure `#000` reads cheap on OLED and crushes hairlines.
- **Type.** Never pure white; ivory at ~94% luminance with a warm bias.
- **Accents.** India reads warm (`#f0a63c`), the United States cool (`#7ba7f0`). The whole
  interface is that duality — East and West, and the meridian between them.
- **Structure.** Institutional density comes from 1px rules, not shadows and radii. Radii
  are tight; trading software does not have pill buttons.
- **Typography.** Inter for the interface. **Instrument Serif** for display — a
  high-contrast editorial face that signals financial press rather than SaaS dashboard.
  **IBM Plex Mono** for every figure: drawn for data, slashed zero, tabular widths so price
  columns never shift as digits change.
- **Texture.** A single tiled fractal-noise layer at ~3% opacity, which kills the flat
  vector-gradient look.
- **Motion.** Hand-tuned easing curves; `expo` for entrances, `swift` for anything the
  pointer is waiting on. Reduced motion is honoured globally in CSS *and* through Framer's
  `MotionConfig`, so nothing can slip through.

---

## Known limits

Stated plainly, because a README that only lists strengths is a sales page.

- **Alerts fire while a Meridian tab is open.** They are evaluated in the browser against
  the shared quote stream. Delivering a trigger to a closed browser needs a server-side
  worker holding subscriptions and a push service — a different piece of infrastructure,
  deliberately out of scope rather than half-implemented and unreliable.
- **The instrument universe is curated**, not exhaustive: ~130 large-cap names plus six
  indices. Walking Twelve Data's full symbol list costs credits and returns tens of
  thousands of rows the interface will never show. `lib/market/universe.ts` is a plain data
  file — extending it is additive.
- **The screener pool is bounded** to the largest 40 names per market, for the same reason.
  One constant.
- **Breadth samples 24 names per region**, not the full market. On a paid plan, raise
  `BREADTH_SAMPLE_PER_REGION` in `lib/twelvedata/overview.ts`.
- **Quote latency depends on your plan.** Twelve Data's free tier is delayed; the UI never
  claims real-time.
- **Simulated data is not market data.** It is a three-factor model — global tide, regional
  index, sector, plus idiosyncratic noise over fractal Brownian motion. Names inside a
  sector move together and the shapes are realistic, which is the point; the numbers are
  not real, which is why every surface showing them says so.
- **No brokerage, tax or dividend accounting** in the portfolio. Cost basis is whatever you
  enter.

---

**Nothing in this application is investment advice.** It is a research and education tool.
Indicators describe what price has already done.
