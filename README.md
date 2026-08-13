# Meridian

**Cross-market intelligence for the Indian and United States equity markets — and the one market that never closes.**

Bengaluru closes at 15:30 IST. New York opens at 09:30 ET — five and a half hours later
and half a world west. Crypto never stops. Meridian is a trading terminal built for the
seam between them: live NSE, BSE, Nasdaq, NYSE and digital-asset data in one surface that
speaks rupees and dollars natively, with cross-market correlation, fundamentals, analyst
consensus, news, portfolio analytics and price alerts.

Data is routed across **five providers**, chosen per request by coverage and remaining
budget. Accounts and sync by Firebase.

---

## Contents

- [What's in it](#whats-in-it)
- [Running it locally](#running-it-locally)
- [Configuration](#configuration)
- [Deploying to Vercel](#deploying-to-vercel)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Design system](#design-system)
- [Known limits](#known-limits)

---

## What's in it

**Nine working surfaces.**

| Route | What it does |
| --- | --- |
| `/` | Marketing page, rendering live index data from the same service layer the terminal uses |
| `/dashboard` | Cross-market overview — indices, crypto, breadth, sector rotation, movers, headlines, India-minus-US spread |
| `/markets` | Indices, participation, sector rotation, digital assets, and a live provider-routing panel |
| `/stock/[slug]` | Chart, technical read, risk stats, cross-market correlation, fundamentals, analyst consensus, earnings history, peers, news |
| `/screener` | Filter NSE and US listings together on direction, session position, sector and magnitude |
| `/compare` | Rebase up to six instruments to 100, with a pairwise correlation matrix |
| `/news` | Market headlines and a per-instrument feed for your watchlist |
| `/watchlist` | Live tracked instruments, sortable, with a list-level summary |
| `/portfolio` | Rupee, dollar and crypto positions in one book, converted at the live rate |
| `/alerts` | Price triggers evaluated against the live stream |

**Some things worth pointing at specifically:**

- **A charting engine written from scratch** (`components/chart/engine.ts`). Range switches
  *morph* — the outgoing series is resampled onto the incoming index space and
  interpolated, so 1M → 1Y is a continuous deformation rather than a redraw. The render
  loop is demand-driven and parks when idle. Every stroke is snapped to the physical pixel
  grid.
- **Keyboard-first.** `⌘K` for the palette, `/` for search, `?` for the shortcut sheet, and
  `g`-prefixed chords (`g d`, `g m`, `g w`…) to jump between sections without a modifier.
- **A 24-hour session dial** plotting both equity sessions against *your* local clock.
- **Indian number formatting throughout** — crore/lakh with 2,32,10,000 grouping on NSE
  listings, billions on US ones.
- **Provenance on every figure.** Each number is labelled `Live`, `Cached` or `Simulated`,
  and the Markets page shows exactly which provider served what and how much budget is
  left.

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # optional — see below
npm run dev
```

Open <http://localhost:3000>.

**It works with zero configuration.** Crypto is genuinely live out of the box — CoinGecko
needs no key. Equities fall back to a correlated simulation, and watchlists, portfolios and
alerts persist to `localStorage`. Every surface is fully functional either way, and
anything not from a live provider is badged as such.

```bash
npm run build      # production build
npm start          # serve the production build
npm run typecheck  # tsc --noEmit
```

`GET /api/health` reports which providers are configured, their remaining budgets, cache
occupancy and session states. It reports presence only — never a key, an email or a project
id — so it is safe to leave public.

---

## Configuration

Everything is optional. Add what you have; each key lights up more of the product.

### Market data — five providers, routed by budget

The governing rule is **spend the scarcest budget last.**

| Provider | Free limit | Used for | Key |
| --- | --- | --- | --- |
| **Finnhub** | 60/min | US quotes, news, analyst consensus, earnings, peers | `FINNHUB_API_KEY` |
| **CoinGecko** | ~30/min | Crypto quotes + history | `COINGECKO_API_KEY` *(optional — works without)* |
| **Twelve Data** | 8/min | India/NSE, and all price history | `TWELVE_DATA_API_KEY` |
| **FMP** | 250/day | Fundamentals, cached 24h | `FMP_API_KEY` |
| **Alpha Vantage** | 25/day | Last-resort fallback | `ALPHA_VANTAGE_API_KEY` |

**Add Finnhub first.** It has the largest budget and is the sole source of news, analyst
ratings, earnings and peers.

Concretely: a US quote goes to Finnhub *because* Twelve Data's eight credits are the only
way to price an NSE listing. Spending them on AAPL is what made RELIANCE fall back to
simulated in the single-provider design.

```bash
FINNHUB_API_KEY=
TWELVE_DATA_API_KEY=
TWELVE_DATA_CREDITS_PER_MINUTE=8   # sizes the governor — set to your real plan limit
COINGECKO_API_KEY=                 # optional, raises the crypto ceiling
FMP_API_KEY=
ALPHA_VANTAGE_API_KEY=
```

> **On Indian data.** Twelve Data's free tier covers US markets only. NSE and BSE quotes
> need a paid plan, so India will read `Simulated` on a free key. That is a subscription
> boundary, not a bug — and the app says so explicitly rather than showing a plausible
> wrong number.

Keys are server-only and deliberately **not** `NEXT_PUBLIC_`. Every provider module imports
`server-only`, so an accidental client import is a build error rather than a leaked key.

### Firebase — accounts and sync

Optional. Without it, personal data persists locally and everything still works; anything
saved as a guest is lifted into the account on first sign-in, so adding this later loses
nothing.

1. **Authentication → Sign-in method** — enable **Email/Password** and **Google**.
2. **Firestore Database** — create in production mode.
3. **Project settings → Your apps → Web** — copy into the `NEXT_PUBLIC_FIREBASE_*` vars.
4. **Project settings → Service accounts → Generate new private key** — for the server vars.

> **Never commit the service-account JSON.** `.gitignore` blocks `firebase-adminsdk-*.json`
> and `*serviceAccount*.json`, but the safe move is to copy the three values into your env
> and delete the file. If one is ever committed, revoke it in the Firebase console
> immediately.
>
> `FIREBASE_PRIVATE_KEY` must keep its newlines — paste it with literal `\n` escapes inside
> double quotes. Or drop the whole JSON blob (raw or base64) into `FIREBASE_SERVICE_ACCOUNT`
> and leave the discrete vars blank.

**Deploy the security rules** — `firestore.rules` ships in this repo:

```bash
firebase deploy --only firestore:rules
```

Add your production domain under **Authentication → Settings → Authorized domains**, or
Google sign-in fails with `auth/unauthorized-domain`.

---

## Deploying to Vercel

1. Import the repo at <https://vercel.com/new>. Next.js is detected automatically.
2. Add the environment variables above.
3. Deploy.

Two notes specific to this app:

- **`/api/stream` holds a connection for ~52s** then closes cleanly; `EventSource`
  reconnects on its own, so the client never sees a gap. This keeps it inside serverless
  execution limits. On a platform with long-lived connections, raise `STREAM_MS` and
  `maxDuration`.
- **The request cache is process-local**, which on Vercel means one warm instance. That is
  intentional — the expensive resource is the provider budget, and the hot path is served
  by whichever instance the connection landed on. `lib/twelvedata/cache.ts` is the single
  seam to swap for Redis if you want it shared.

---

## Architecture

### The constraint that shapes everything

Market-data plans bill per symbol per request, and every free tier meters differently —
Finnhub per minute, FMP per day, Twelve Data in *credits* where one batched quote for
twenty symbols costs twenty. That single fact determines what gets cached, for how long,
what degrades, and what is computed locally instead of bought.

**Capability-based provider routing** — `lib/providers/registry.ts`
Each provider declares what it covers and what it can do. Chains are built per capability
*and* per instrument, so an NSE symbol is never sent to a US-only provider just to collect
the 403. A provider already out of budget is skipped without a request, so failover costs
no wall time when the answer is knowable up front.

**Per-provider governors with minute and day windows** — `lib/providers/limiter.ts`
Acquisitions serialise through a promise chain so two concurrent callers cannot both claim
the same free slot. A daily budget cannot be waited out inside a request, so it refuses
immediately and the caller moves down the chain. A per-minute budget waits only if the wait
is shorter than a serverless invocation should hold open.

**Single-flight cache with stale-while-revalidate** — `lib/twelvedata/cache.ts`
Twenty components asking for RELIANCE at once produce one upstream call. Past its TTL the
cached value is still served while a refresh runs behind the request. Past a hard ceiling
it is refused outright — a nine-minute-old quote presented as current is worse than none.

**Graceful degradation, labelled** — `lib/twelvedata/service.ts`
Every read resolves to `live`, `cached` or `simulated`, propagated to a badge in the UI. The
degradation notice names *which* instruments fell back and why, because "Indian listings
need a paid plan" and "every provider is down" require completely different responses.

**One stream for the whole app** — `lib/hooks/market-data.tsx`
Components declare the symbols they need; a reference-counted subscription set drives a
single SSE connection. Changes are debounced — a forty-row table mounts forty subscribers in
one frame. Only changed prices go over the wire, and a blocked stream falls back to polling.

**Indicators computed locally** — `lib/analytics/indicators.ts`
RSI, MACD, Bollinger, ATR, VWAP, OBV, correlation, beta, Sharpe, Sortino and drawdown are
pure functions of bars already on the client. Every series is aligned to the input length
with `null` in the warm-up region, so overlays can never render one bar off.

**Sessions from an httpOnly cookie** — `lib/firebase/admin.ts`
The Firebase ID token is exchanged server-side for a cookie JavaScript cannot read, so
authenticated pages render on the server with no unauthenticated flash. Every
`firebase-admin` import is *dynamic*: a static top-level import means a bundling failure
throws during module evaluation, before any guard can run, and takes down every route that
touches it with a bare 500. Loading it lazily moves that failure into a `try/catch` we
control.

**Personal data with two backends** — `lib/store/personal.tsx`
Signed in, a single Firestore document with a live listener. Otherwise `localStorage`. The
interface is identical, and guest work is merged into the account on first sign-in.

---

## Project layout

```
app/
  (auth)/                 login + signup, split layout with the live product alongside
  (app)/                  the terminal shell — rail, topbar, tape, alerts, shortcuts
    dashboard/ markets/ screener/ compare/ news/
    watchlist/ portfolio/ alerts/ stock/[slug]/
  api/
    quotes/ series/ overview/ search/ profile/ fx/     market data
    news/ fundamentals/                                research
    stream/                                            server-sent events
    session/                                           Firebase session cookie
    health/                                            ops + provider status
  page.tsx globals.css

lib/
  providers/              registry, limiter, http + finnhub, coingecko,
                          twelvedata, fmp, alphavantage
  twelvedata/             cache, service, overview, simulate, types
  analytics/              indicators, portfolio
  market/                 exchanges, universe, timezone
  firebase/ store/ hooks/
  format.ts utils.ts

components/
  chart/ market/ shell/ ui/ views/ marketing/ brand/ auth/

firestore.rules
```

---

## Design system

Dark by commitment — this is a terminal, and one palette lets the data carry the colour.

- **Ground.** Warm-shifted blacks. Pure `#000` reads cheap on OLED and crushes hairlines.
- **Type.** Never pure white; ivory at ~94% luminance with a warm bias.
- **Accents.** India warm (`#f0a63c`), the US cool (`#7ba7f0`), digital assets teal
  (`#4fd1c5`) — a third hue rather than borrowing one and muddying the regional coding.
- **Structure.** Density comes from 1px rules, not shadows and radii. Radii are tight;
  trading software does not have pill buttons.
- **Typography.** Inter for the interface, **Instrument Serif** for display, **IBM Plex
  Mono** for every figure — drawn for data, slashed zero, tabular widths so price columns
  never shift as digits change.
- **Motion.** Hand-tuned curves; `expo` for entrances, `swift` for anything the pointer is
  waiting on. Reduced motion is honoured globally in CSS *and* through `MotionConfig`.

### Responsive and native feel

- Horizontal bleed is blocked at the root, and every wide surface — tables, control strips,
  range pickers — scrolls inside its own container. `min-w-0` on flex and grid children is
  load-bearing: without it a wide table sets the column's intrinsic width and the whole page
  scrolls sideways.
- Safe-area insets are respected on notched devices; bottom chrome is one stacked container
  so the tape and mobile nav cannot overlap.
- Touch targets clear 44px, the chart height adapts to viewport, and momentum scrolling is
  enabled on every horizontal strip.

---

## Known limits

Stated plainly, because a README that only lists strengths is a sales page.

- **Indian data needs a paid Twelve Data plan.** The free tier is US-only. India reads
  `Simulated` until you upgrade.
- **News, fundamentals, analyst ratings, earnings and peers are US-only** on these free
  tiers. The panels say so rather than rendering empty.
- **Alerts fire while a Meridian tab is open.** Push to a closed browser needs a
  server-side worker and a push service — deliberately out of scope rather than
  half-implemented.
- **The instrument universe is curated**, not exhaustive: ~130 large caps, six indices and
  eighteen digital assets. `lib/market/universe.ts` is a plain data file; extending it is
  additive.
- **The screener pool and breadth sample are bounded** for budget reasons. Both are single
  constants.
- **Quote latency depends on your plan.** The UI never claims real-time.
- **Simulated data is not market data.** A three-factor model — global tide, regional index,
  sector, plus idiosyncratic noise over fractal Brownian motion. Shapes are realistic; the
  numbers are not real, which is why every surface showing them says so.
- **No brokerage, tax or dividend accounting** in the portfolio.

---

**Nothing in this application is investment advice.** It is a research and education tool.
Indicators describe what price has already done.
