"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { doc, onSnapshot, setDoc, type DocumentData } from "firebase/firestore";

import { firebaseDb } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-context";
import { uid as makeId } from "@/lib/utils";
import { DEFAULT_PREFERENCES, EMPTY_PERSONAL } from "@/lib/store/types";
import type {
  AlertKind,
  PersonalState,
  Position,
  Preferences,
  PriceAlert,
  StorageMode,
} from "@/lib/store/types";
import { DEFAULT_WATCHLIST, findBySlug } from "@/lib/market/universe";

/**
 * Personal data: watchlist, positions, alerts, preferences.
 *
 * Two backends behind one interface. Signed in with Firebase configured, this
 * is a single Firestore document with a live listener, so an edit on a phone
 * lands on a desktop tab in a few hundred milliseconds. Otherwise it is
 * localStorage. The interface is identical either way, which means no
 * component has to know or care, and a visitor can build a real watchlist
 * before deciding whether to create an account — that work then follows them
 * up to the cloud on first sign-in.
 *
 * Everything lives in one document rather than subcollections. A personal book
 * is tens of rows, not thousands; one document means one read, one listener
 * and atomic writes, instead of N reads and a fan-out of listeners.
 */

const LOCAL_KEY = "meridian.personal.v1";
const SCHEMA_VERSION = 1;

interface PersonalContextValue extends PersonalState {
  ready: boolean;
  mode: StorageMode;
  /** Set once local data has been merged into a newly signed-in account. */
  migrated: boolean;

  isWatched: (slug: string) => boolean;
  toggleWatch: (slug: string) => void;
  addToWatchlist: (slug: string) => void;
  removeFromWatchlist: (slug: string) => void;
  reorderWatchlist: (slugs: string[]) => void;

  addPosition: (input: Omit<Position, "id" | "openedAt"> & { openedAt?: number }) => void;
  updatePosition: (id: string, patch: Partial<Omit<Position, "id">>) => void;
  removePosition: (id: string) => void;

  addAlert: (input: {
    slug: string;
    kind: AlertKind;
    threshold: number;
    basePrice: number;
    note?: string;
  }) => void;
  updateAlert: (id: string, patch: Partial<Omit<PriceAlert, "id">>) => void;
  removeAlert: (id: string) => void;
  markAlertTriggered: (id: string, at: number) => void;

  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  resetAll: () => void;
}

const PersonalContext = createContext<PersonalContextValue | null>(null);

/* ── Serialisation ────────────────────────────────────────────────────────── */

/**
 * Never trust persisted shape. A document written by an older build, or by a
 * user poking at localStorage, must not be able to crash a render.
 */
function coerceState(raw: unknown): PersonalState {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_PERSONAL };
  const r = raw as Record<string, unknown>;

  const watchlist = Array.isArray(r["watchlist"])
    ? (r["watchlist"] as unknown[])
        .filter((s): s is string => typeof s === "string")
        .filter((s) => Boolean(findBySlug(s)))
    : [];

  const positions = Array.isArray(r["positions"])
    ? (r["positions"] as unknown[]).flatMap((p) => {
        const pos = coercePosition(p);
        return pos ? [pos] : [];
      })
    : [];

  const alerts = Array.isArray(r["alerts"])
    ? (r["alerts"] as unknown[]).flatMap((a) => {
        const alert = coerceAlert(a);
        return alert ? [alert] : [];
      })
    : [];

  const prefsRaw = (r["preferences"] ?? {}) as Record<string, unknown>;
  const preferences: Preferences = {
    baseCurrency: prefsRaw["baseCurrency"] === "USD" ? "USD" : "INR",
    defaultRange: (typeof prefsRaw["defaultRange"] === "string"
      ? prefsRaw["defaultRange"]
      : DEFAULT_PREFERENCES.defaultRange) as Preferences["defaultRange"],
    chartStyle: prefsRaw["chartStyle"] === "candles" ? "candles" : "area",
    indicators: Array.isArray(prefsRaw["indicators"])
      ? (prefsRaw["indicators"] as unknown[]).filter((x): x is string => typeof x === "string")
      : DEFAULT_PREFERENCES.indicators,
    reducedMotion: prefsRaw["reducedMotion"] === true,
  };

  return { watchlist, positions, alerts, preferences };
}

function coercePosition(p: unknown): Position | null {
  if (typeof p !== "object" || p === null) return null;
  const r = p as Record<string, unknown>;
  const slug = typeof r["slug"] === "string" ? r["slug"] : null;
  const inst = slug ? findBySlug(slug) : undefined;
  const quantity = Number(r["quantity"]);
  const avgPrice = Number(r["avgPrice"]);
  if (!inst || !Number.isFinite(quantity) || !Number.isFinite(avgPrice)) return null;

  return {
    id: typeof r["id"] === "string" ? r["id"] : makeId("pos"),
    slug: inst.slug,
    symbol: inst.symbol,
    name: inst.name,
    currency: inst.currency,
    quantity,
    avgPrice,
    openedAt: Number(r["openedAt"]) || Date.now(),
    ...(typeof r["note"] === "string" ? { note: r["note"] } : {}),
  };
}

function coerceAlert(a: unknown): PriceAlert | null {
  if (typeof a !== "object" || a === null) return null;
  const r = a as Record<string, unknown>;
  const slug = typeof r["slug"] === "string" ? r["slug"] : null;
  const inst = slug ? findBySlug(slug) : undefined;
  const threshold = Number(r["threshold"]);
  const kind = r["kind"];
  const validKind =
    kind === "above" || kind === "below" || kind === "pct-gain" || kind === "pct-loss";
  if (!inst || !Number.isFinite(threshold) || !validKind) return null;

  return {
    id: typeof r["id"] === "string" ? r["id"] : makeId("alert"),
    slug: inst.slug,
    symbol: inst.symbol,
    name: inst.name,
    currency: inst.currency,
    kind,
    threshold,
    basePrice: Number(r["basePrice"]) || 0,
    active: r["active"] !== false,
    createdAt: Number(r["createdAt"]) || Date.now(),
    ...(Number.isFinite(Number(r["triggeredAt"])) && Number(r["triggeredAt"]) > 0
      ? { triggeredAt: Number(r["triggeredAt"]) }
      : {}),
    ...(typeof r["note"] === "string" ? { note: r["note"] } : {}),
  };
}

function readLocal(): PersonalState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return coerceState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(state: PersonalState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...state, schema: SCHEMA_VERSION }));
  } catch {
    // Quota exceeded or storage disabled (Safari private mode). In-memory
    // state still works for the session.
  }
}

/* ── Provider ─────────────────────────────────────────────────────────────── */

export function PersonalProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<PersonalState>(EMPTY_PERSONAL);
  const [ready, setReady] = useState(false);
  const [migrated, setMigrated] = useState(false);

  const mode: StorageMode = user && firebaseDb() ? "cloud" : "local";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** Guards the very first cloud snapshot, which is where migration happens. */
  const firstSnapshot = useRef(true);

  // Hydrate from local storage immediately so the UI is never empty on first
  // paint, then let the cloud listener take over if there is one.
  useEffect(() => {
    const local = readLocal();
    setState(local ?? { ...EMPTY_PERSONAL, watchlist: DEFAULT_WATCHLIST });
    if (!authLoading && !user) setReady(true);
  }, [authLoading, user]);

  // Cloud listener.
  useEffect(() => {
    if (authLoading) return;
    const db = firebaseDb();
    if (!user || !db) return;

    firstSnapshot.current = true;
    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const remote = snap.exists() ? coerceState(snap.data() as DocumentData) : null;

        if (firstSnapshot.current) {
          firstSnapshot.current = false;
          const local = readLocal();
          const remoteEmpty =
            !remote ||
            (remote.watchlist.length === 0 &&
              remote.positions.length === 0 &&
              remote.alerts.length === 0);

          // First sign-in on a device where work was already done as a guest:
          // lift it into the account rather than silently discarding it.
          if (remoteEmpty && local && (local.watchlist.length || local.positions.length || local.alerts.length)) {
            const seeded = remote ? mergeState(remote, local) : local;
            setState(seeded);
            void persistCloud(user.uid, seeded);
            setMigrated(true);
            setReady(true);
            return;
          }

          setState(remote ?? { ...EMPTY_PERSONAL, watchlist: DEFAULT_WATCHLIST });
          if (!remote) void persistCloud(user.uid, { ...EMPTY_PERSONAL, watchlist: DEFAULT_WATCHLIST });
          setReady(true);
          return;
        }

        if (remote) setState(remote);
        setReady(true);
      },
      () => {
        // Permission denied or offline: fall back to whatever is local.
        setState(readLocal() ?? { ...EMPTY_PERSONAL, watchlist: DEFAULT_WATCHLIST });
        setReady(true);
      },
    );

    return unsub;
  }, [user, authLoading]);

  /**
   * Single write path. Applies the reducer locally for an instant response,
   * then persists — Firestore's own offline queue handles retries, so there is
   * no need for optimistic-update bookkeeping on top.
   */
  const mutate = useCallback(
    (fn: (prev: PersonalState) => PersonalState) => {
      setState((prev) => {
        const next = fn(prev);
        writeLocal(next);
        if (modeRef.current === "cloud" && user) void persistCloud(user.uid, next);
        return next;
      });
    },
    [user],
  );

  const isWatched = useCallback((slug: string) => state.watchlist.includes(slug), [state.watchlist]);

  const addToWatchlist = useCallback(
    (slug: string) => {
      const inst = findBySlug(slug);
      if (!inst) return;
      mutate((p) =>
        p.watchlist.includes(inst.slug) ? p : { ...p, watchlist: [inst.slug, ...p.watchlist] },
      );
    },
    [mutate],
  );

  const removeFromWatchlist = useCallback(
    (slug: string) => mutate((p) => ({ ...p, watchlist: p.watchlist.filter((s) => s !== slug) })),
    [mutate],
  );

  const toggleWatch = useCallback(
    (slug: string) => {
      const inst = findBySlug(slug);
      if (!inst) return;
      mutate((p) =>
        p.watchlist.includes(inst.slug)
          ? { ...p, watchlist: p.watchlist.filter((s) => s !== inst.slug) }
          : { ...p, watchlist: [inst.slug, ...p.watchlist] },
      );
    },
    [mutate],
  );

  const reorderWatchlist = useCallback(
    (slugs: string[]) => mutate((p) => ({ ...p, watchlist: slugs.filter((s) => findBySlug(s)) })),
    [mutate],
  );

  const addPosition = useCallback<PersonalContextValue["addPosition"]>(
    (input) => {
      const inst = findBySlug(input.slug);
      if (!inst) return;
      const position: Position = {
        id: makeId("pos"),
        slug: inst.slug,
        symbol: inst.symbol,
        name: inst.name,
        currency: inst.currency,
        quantity: input.quantity,
        avgPrice: input.avgPrice,
        openedAt: input.openedAt ?? Date.now(),
        ...(input.note ? { note: input.note } : {}),
      };
      mutate((p) => ({ ...p, positions: [position, ...p.positions] }));
    },
    [mutate],
  );

  const updatePosition = useCallback<PersonalContextValue["updatePosition"]>(
    (id, patch) =>
      mutate((p) => ({
        ...p,
        positions: p.positions.map((pos) => (pos.id === id ? { ...pos, ...patch } : pos)),
      })),
    [mutate],
  );

  const removePosition = useCallback(
    (id: string) => mutate((p) => ({ ...p, positions: p.positions.filter((x) => x.id !== id) })),
    [mutate],
  );

  const addAlert = useCallback<PersonalContextValue["addAlert"]>(
    (input) => {
      const inst = findBySlug(input.slug);
      if (!inst) return;
      const alert: PriceAlert = {
        id: makeId("alert"),
        slug: inst.slug,
        symbol: inst.symbol,
        name: inst.name,
        currency: inst.currency,
        kind: input.kind,
        threshold: input.threshold,
        basePrice: input.basePrice,
        active: true,
        createdAt: Date.now(),
        ...(input.note ? { note: input.note } : {}),
      };
      mutate((p) => ({ ...p, alerts: [alert, ...p.alerts] }));
    },
    [mutate],
  );

  const updateAlert = useCallback<PersonalContextValue["updateAlert"]>(
    (id, patch) =>
      mutate((p) => ({
        ...p,
        alerts: p.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      })),
    [mutate],
  );

  const removeAlert = useCallback(
    (id: string) => mutate((p) => ({ ...p, alerts: p.alerts.filter((a) => a.id !== id) })),
    [mutate],
  );

  const markAlertTriggered = useCallback(
    (id: string, at: number) =>
      mutate((p) => ({
        ...p,
        alerts: p.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: at, active: false } : a)),
      })),
    [mutate],
  );

  const setPreference = useCallback<PersonalContextValue["setPreference"]>(
    (key, value) => mutate((p) => ({ ...p, preferences: { ...p.preferences, [key]: value } })),
    [mutate],
  );

  const resetAll = useCallback(() => {
    mutate(() => ({ ...EMPTY_PERSONAL, watchlist: DEFAULT_WATCHLIST }));
  }, [mutate]);

  const value = useMemo<PersonalContextValue>(
    () => ({
      ...state,
      ready,
      mode,
      migrated,
      isWatched,
      toggleWatch,
      addToWatchlist,
      removeFromWatchlist,
      reorderWatchlist,
      addPosition,
      updatePosition,
      removePosition,
      addAlert,
      updateAlert,
      removeAlert,
      markAlertTriggered,
      setPreference,
      resetAll,
    }),
    [
      state, ready, mode, migrated, isWatched, toggleWatch, addToWatchlist, removeFromWatchlist,
      reorderWatchlist, addPosition, updatePosition, removePosition, addAlert, updateAlert,
      removeAlert, markAlertTriggered, setPreference, resetAll,
    ],
  );

  return <PersonalContext.Provider value={value}>{children}</PersonalContext.Provider>;
}

async function persistCloud(uid: string, state: PersonalState) {
  const db = firebaseDb();
  if (!db) return;
  try {
    await setDoc(
      doc(db, "users", uid),
      { ...state, schema: SCHEMA_VERSION, updatedAt: Date.now() },
      { merge: true },
    );
  } catch {
    // Offline writes are queued by the SDK; a hard failure here means rules
    // rejected the write, which the console will surface.
  }
}

/** Union merge used when guest data meets an empty account. */
function mergeState(remote: PersonalState, local: PersonalState): PersonalState {
  const seen = new Set(remote.watchlist);
  return {
    watchlist: [...remote.watchlist, ...local.watchlist.filter((s) => !seen.has(s))],
    positions: [...remote.positions, ...local.positions],
    alerts: [...remote.alerts, ...local.alerts],
    preferences: { ...remote.preferences, ...local.preferences },
  };
}

export function usePersonal(): PersonalContextValue {
  const ctx = useContext(PersonalContext);
  if (!ctx) throw new Error("usePersonal must be used inside <PersonalProvider>");
  return ctx;
}
