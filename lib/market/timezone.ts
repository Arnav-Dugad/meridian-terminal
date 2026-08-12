/**
 * Timezone arithmetic without a date library.
 *
 * The only primitive needed anywhere in the app is "what is the UTC offset of
 * this IANA zone at this instant" — from which local wall-clock time, session
 * boundaries and the 24-hour dial all follow. `Intl.DateTimeFormat` already
 * carries the full tzdata the platform ships, including historical and DST
 * transitions, so formatting an instant into the zone and reading the parts
 * back is both correct and free of a 70kB dependency.
 */

const cache = new Map<string, number>();

function formatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function getFormatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = formatter(tz);
    formatters.set(tz, f);
  }
  return f;
}

/**
 * Milliseconds to add to a UTC instant to get wall-clock time in `tz`.
 * Cached per zone per hour, which is fine — offsets only change on the hour.
 */
export function zoneOffsetMs(tz: string, at: number = Date.now()): number {
  const key = `${tz}:${Math.floor(at / 3_600_000)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const parts = getFormatter(tz).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  const offset = asUtc - Math.floor(at / 1000) * 1000;

  if (cache.size > 128) cache.clear();
  cache.set(key, offset);
  return offset;
}

export function zoneOffsetMinutes(tz: string, at: number = Date.now()): number {
  return Math.round(zoneOffsetMs(tz, at) / 60_000);
}

/** Minutes past local midnight in `tz`. */
export function minutesInZone(tz: string, at: number = Date.now()): number {
  const local = at + zoneOffsetMs(tz, at);
  return Math.floor((local % 86_400_000) / 60_000);
}

/**
 * Convert a wall-clock minute in `fromTz` to the equivalent minute in `toTz`,
 * wrapped into [0, 1440). Used to place foreign sessions on a local dial.
 */
export function convertMinutes(
  minute: number,
  fromTz: string,
  toTz: string,
  at: number = Date.now(),
): number {
  const delta = zoneOffsetMinutes(toTz, at) - zoneOffsetMinutes(fromTz, at);
  return ((minute + delta) % 1440 + 1440) % 1440;
}

/** The viewer's own zone, with a safe fallback. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `UTC+05:30` — for labelling a dial or a footer. */
export function formatOffset(tz: string, at: number = Date.now()): string {
  const mins = zoneOffsetMinutes(tz, at);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
