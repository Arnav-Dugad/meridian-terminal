/**
 * Options analytics.
 *
 * The chain itself is a table; what a desk actually reads is the structure
 * inside it — where open interest is stacked, where the pain is, whether puts
 * or calls dominate, and how implied volatility bends across strikes. All of
 * that is arithmetic on data we already have, so it is computed here rather
 * than bought.
 */

export interface OptionLeg {
  strike: number;
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  volume: number;
  openInterest: number;
  impliedVolatility: number | null;
  inTheMoney: boolean;
}

export interface OptionChain {
  symbol: string;
  /** Epoch ms of the expiry being shown. */
  expiry: number;
  /** All expiries the provider offers, epoch ms. */
  expiries: number[];
  spot: number;
  calls: OptionLeg[];
  puts: OptionLeg[];
  currency: string;
}

/* ── Max pain ─────────────────────────────────────────────────────────────── */

export interface MaxPainPoint {
  strike: number;
  /** Total intrinsic value written option holders would collect, in currency. */
  totalPain: number;
  callPain: number;
  putPain: number;
}

export interface MaxPainResult {
  /** The strike at which option writers lose least. */
  strike: number;
  /** Distance from spot, as a percentage. */
  distancePercent: number;
  curve: MaxPainPoint[];
}

/**
 * Max pain.
 *
 * The strike at which the aggregate intrinsic value of all open contracts is
 * smallest — that is, where the people who *wrote* the options pay out least.
 * The theory that price gravitates there before expiry is contested and this
 * makes no claim about it; what the number genuinely gives you is a
 * concentration read: where the open interest actually sits, expressed as a
 * single price.
 *
 * For each candidate strike K, a call at strike S is worth max(0, K − S) and a
 * put max(0, S − K), each multiplied by its open interest. The minimum of that
 * sum across all strikes is max pain.
 */
export function computeMaxPain(chain: OptionChain): MaxPainResult | null {
  const strikes = Array.from(
    new Set([...chain.calls.map((c) => c.strike), ...chain.puts.map((p) => p.strike)]),
  ).sort((a, b) => a - b);

  if (strikes.length < 3) return null;

  const curve: MaxPainPoint[] = strikes.map((candidate) => {
    let callPain = 0;
    for (const call of chain.calls) {
      if (candidate > call.strike) callPain += (candidate - call.strike) * call.openInterest;
    }

    let putPain = 0;
    for (const put of chain.puts) {
      if (candidate < put.strike) putPain += (put.strike - candidate) * put.openInterest;
    }

    return { strike: candidate, callPain, putPain, totalPain: callPain + putPain };
  });

  const withOi = curve.filter((p) => p.totalPain > 0);
  if (withOi.length === 0) return null;

  const min = withOi.reduce((a, b) => (b.totalPain < a.totalPain ? b : a));

  return {
    strike: min.strike,
    distancePercent: chain.spot > 0 ? ((min.strike - chain.spot) / chain.spot) * 100 : 0,
    curve,
  };
}

/* ── Open interest profile ────────────────────────────────────────────────── */

export interface OiRow {
  strike: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  callIv: number | null;
  putIv: number | null;
  /** True when this strike is the nearest to spot. */
  atTheMoney: boolean;
}

/**
 * The chain collapsed into one row per strike.
 *
 * Windowed around spot because a full chain runs to hundreds of strikes, most
 * of them far out of the money with negligible interest — showing all of them
 * buries the part that matters.
 */
export function openInterestProfile(chain: OptionChain, window = 16): OiRow[] {
  const byStrike = new Map<number, OiRow>();

  const ensure = (strike: number): OiRow => {
    let row = byStrike.get(strike);
    if (!row) {
      row = {
        strike,
        callOi: 0,
        putOi: 0,
        callVolume: 0,
        putVolume: 0,
        callIv: null,
        putIv: null,
        atTheMoney: false,
      };
      byStrike.set(strike, row);
    }
    return row;
  };

  for (const c of chain.calls) {
    const row = ensure(c.strike);
    row.callOi = c.openInterest;
    row.callVolume = c.volume;
    row.callIv = c.impliedVolatility;
  }
  for (const p of chain.puts) {
    const row = ensure(p.strike);
    row.putOi = p.openInterest;
    row.putVolume = p.volume;
    row.putIv = p.impliedVolatility;
  }

  const all = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
  if (all.length === 0) return [];

  // Centre the window on the strike closest to spot.
  let atmIndex = 0;
  let best = Infinity;
  for (let i = 0; i < all.length; i++) {
    const d = Math.abs(all[i]!.strike - chain.spot);
    if (d < best) {
      best = d;
      atmIndex = i;
    }
  }
  all[atmIndex]!.atTheMoney = true;

  const half = Math.floor(window / 2);
  const start = Math.max(0, atmIndex - half);
  return all.slice(start, start + window);
}

/* ── Positioning summary ──────────────────────────────────────────────────── */

export interface OptionsSummary {
  totalCallOi: number;
  totalPutOi: number;
  /** Put open interest divided by call open interest. */
  putCallRatio: number;
  totalCallVolume: number;
  totalPutVolume: number;
  volumePutCallRatio: number;
  /** Strike carrying the most call open interest — often read as resistance. */
  maxCallOiStrike: number | null;
  /** Strike carrying the most put open interest — often read as support. */
  maxPutOiStrike: number | null;
  /** At-the-money implied volatility, averaged across the call and put. */
  atmIv: number | null;
  /** Days until expiry. */
  daysToExpiry: number;
  /** Plain-language read of the positioning. */
  interpretation: string;
}

export function summariseOptions(chain: OptionChain): OptionsSummary {
  const totalCallOi = chain.calls.reduce((s, c) => s + c.openInterest, 0);
  const totalPutOi = chain.puts.reduce((s, p) => s + p.openInterest, 0);
  const totalCallVolume = chain.calls.reduce((s, c) => s + c.volume, 0);
  const totalPutVolume = chain.puts.reduce((s, p) => s + p.volume, 0);

  const topBy = (legs: OptionLeg[]) =>
    legs.length === 0
      ? null
      : legs.reduce((a, b) => (b.openInterest > a.openInterest ? b : a)).strike;

  const nearest = (legs: OptionLeg[]) =>
    legs.length === 0
      ? null
      : legs.reduce((a, b) =>
          Math.abs(b.strike - chain.spot) < Math.abs(a.strike - chain.spot) ? b : a,
        );

  const atmCall = nearest(chain.calls);
  const atmPut = nearest(chain.puts);
  const ivs = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(
    (v): v is number => v != null && v > 0,
  );

  const putCallRatio = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;
  const daysToExpiry = Math.max(0, Math.round((chain.expiry - Date.now()) / 86_400_000));

  return {
    totalCallOi,
    totalPutOi,
    putCallRatio,
    totalCallVolume,
    totalPutVolume,
    volumePutCallRatio: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
    maxCallOiStrike: topBy(chain.calls),
    maxPutOiStrike: topBy(chain.puts),
    atmIv: ivs.length > 0 ? (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 : null,
    daysToExpiry,
    interpretation: interpret(putCallRatio, daysToExpiry),
  };
}

/**
 * Read the put/call ratio the way a desk would.
 *
 * The convention is contrarian at the extremes: a very high ratio means
 * everyone has already bought protection, which historically marks fear rather
 * than predicting further falls. This is framed as positioning, not a signal.
 */
function interpret(pcr: number, days: number): string {
  const horizon = days <= 2 ? "into expiry" : days <= 10 ? "over the next week or so" : "for this expiry";

  if (pcr === 0) return "No meaningful open interest on this expiry.";
  if (pcr > 1.4) {
    return `Heavily put-weighted ${horizon} — a lot of downside protection is already owned, which at extremes has more often marked fear than predicted further falls.`;
  }
  if (pcr > 1.05) return `Modestly put-weighted ${horizon}: positioning leans defensive.`;
  if (pcr < 0.6) {
    return `Heavily call-weighted ${horizon} — positioning is crowded on the upside, which leaves less fuel from new buying.`;
  }
  if (pcr < 0.9) return `Modestly call-weighted ${horizon}: positioning leans constructive.`;
  return `Balanced between calls and puts ${horizon} — no strong directional lean in positioning.`;
}
