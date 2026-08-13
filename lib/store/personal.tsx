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
import { DEFAULT_PREFERENCES, EMPTY_PERSONAL, LIMITS } from "@/lib/store/types";
import type {
  AlertKind,
  InstrumentNote,
  PersonalState,
  PortfolioSnapshot,
  Position,
  Preferences,
  PriceAlert,
  SavedScreen,
  StorageMode,
  Workspace,
  WorkspacePane,
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

  recordView: (slug: string) => void;

  noteFor: (slug: string) => InstrumentNote | undefined;
  saveNote: (slug: string, body: string) => void;
  removeNote: (slug: string) => void;

  saveScreen: (screen: Omit<SavedScreen, "id" | "createdAt">) => void;
  removeScreen: (id: string) => void;

  recordSnapshot: (snapshot: Omit<PortfolioSnapshot, "recordedAt">) => void;

  saveWorkspace: (name: string, panes: WorkspacePane[], id?: string) => string;
  removeWorkspace: (id: string) => void;
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
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

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
    theme: oneOf(prefsRaw["theme"], ["dark", "light", "system"] as const, DEFAULT_PREFERENCES.theme),
    density: oneOf(prefsRaw["density"], ["comfortable", "compact"] as const, DEFAULT_PREFERENCES.density),
    homeRegion: oneOf(prefsRaw["homeRegion"], ["IN", "US", "GLOBAL"] as const, DEFAULT_PREFERENCES.homeRegion),
    showTape: bool(prefsRaw["showTape"], DEFAULT_PREFERENCES.showTape),
    flashTicks: bool(prefsRaw["flashTicks"], DEFAULT_PREFERENCES.flashTicks),
    riskFreeRate: clampNum(prefsRaw["riskFreeRate"], 0, 25, DEFAULT_PREFERENCES.riskFreeRate),
    backtestCostBps: clampNum(prefsRaw["backtestCostBps"], 0, 100, DEFAULT_PREFERENCES.backtestCostBps),
    desktopNotifications: bool(prefsRaw["desktopNotifications"], DEFAULT_PREFERENCES.desktopNotifications),
  };

  const recentlyViewed = Array.isArray(r["recentlyViewed"])
    ? (r["recentlyViewed"] as unknown[])
        .filter((s): s is string => typeof s === "string")
        .filter((s) => Boolean(findBySlug(s)))
        .slice(0, LIMITS.recentlyViewed)
    : [];

  const notes = Array.isArray(r["notes"])
    ? (r["notes"] as unknown[]).flatMap((n) => {
        const note = coerceNote(n);
        return note ? [note] : [];
      })
    : [];

  const savedScreens = Array.isArray(r["savedScreens"])
    ? (r["savedScreens"] as unknown[]).flatMap((s) => {
        const screen = coerceScreen(s);
        return screen ? [screen] : [];
      })
    : [];

  const snapshots = Array.isArray(r["snapshots"])
    ? (r["snapshots"] as unknown[])
        .flatMap((s) => {
          const snap = coerceSnapshot(s);
          return snap ? [snap] : [];
        })
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const workspaces = Array.isArray(r["workspaces"])
    ? (r["workspaces"] as unknown[]).flatMap((w) => {
        const ws = coerceWorkspace(w);
        return ws ? [ws] : [];
      })
    : [];

  return {
    watchlist,
    positions,
    alerts,
    preferences,
    recentlyViewed,
    notes,
    savedScreens,
    snapshots,
    workspaces,
  };
}

function coerceWorkspace(w: unknown): Workspace | null {
  if (typeof w !== "object" || w === null) return null;
  const r = w as Record<string, unknown>;
  const name = typeof r["name"] === "string" ? r["name"].slice(0, 48) : null;
  if (!name) return null;

  const panes = Array.isArray(r["panes"])
    ? (r["panes"] as unknown[])
        .flatMap((p) => {
          if (typeof p !== "object" || p === null) return [];
          const pr = p as Record<string, unknown>;
          const inst = typeof pr["slug"] === "string" ? findBySlug(pr["slug"]) : undefined;
          if (!inst) return [];
          return [
            {
              slug: inst.slug,
              range: (typeof pr["range"] === "string" ? pr["range"] : "6M") as WorkspacePane["range"],
              style: pr["style"] === "candles" ? ("candles" as const) : ("area" as const),
            },
          ];
        })
        .slice(0, LIMITS.panes)
    : [];

  if (panes.length === 0) return null;

  return {
    id: typeof r["id"] === "string" ? r["id"] : makeId("ws"),
    name,
    panes,
    createdAt: Number(r["createdAt"]) || Date.now(),
    updatedAt: Number(r["updatedAt"]) || Date.now(),
  };
}

function coerceNote(n: unknown): InstrumentNote | null {
  if (typeof n !== "object" || n === null) return null;
  const r = n as Record<string, unknown>;
  const slug = typeof r["slug"] === "string" ? r["slug"] : null;
  const inst = slug ? findBySlug(slug) : undefined;
  const body = typeof r["body"] === "string" ? r["body"] : null;
  if (!inst || !body) return null;
  return {
    slug: inst.slug,
    symbol: inst.symbol,
    body: body.slice(0, 4000),
    updatedAt: Number(r["updatedAt"]) || Date.now(),
  };
}

function coerceScreen(s: unknown): SavedScreen | null {
  if (typeof s !== "object" || s === null) return null;
  const r = s as Record<string, unknown>;
  const name = typeof r["name"] === "string" ? r["name"].slice(0, 60) : null;
  if (!name) return null;
  const strings = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    id: typeof r["id"] === "string" ? r["id"] : makeId("screen"),
    name,
    regions: strings(r["regions"]),
    sectors: strings(r["sectors"]),
    changeFilter: typeof r["changeFilter"] === "string" ? r["changeFilter"] : "any",
    rangeFilter: typeof r["rangeFilter"] === "string" ? r["rangeFilter"] : "any",
    minChange: Number(r["minChange"]) || 0,
    createdAt: Number(r["createdAt"]) || Date.now(),
  };
}

function coerceSnapshot(s: unknown): PortfolioSnapshot | null {
  if (typeof s !== "object" || s === null) return null;
  const r = s as Record<string, unknown>;
  const date = typeof r["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r["date"]) ? r["date"] : null;
  const value = Number(r["value"]);
  if (!date || !Number.isFinite(value)) return null;
  return {
    date,
    value,
    cost: Number(r["cost"]) || 0,
    pnl: Number(r["pnl"]) || 0,
    baseCurrency: r["baseCurrency"] === "USD" ? "USD" : "INR",
    positionCount: Number(r["positionCount"]) || 0,
    fxRate: Number(r["fxRate"]) || 0,
    recordedAt: Number(r["recordedAt"]) || Date.now(),
  };
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

  /**
   * Recently viewed. Deduplicated and capped, so the list is a genuine
   * most-recent-first history rather than an append-only log.
   */
  const recordView = useCallback(
    (slug: string) => {
      const inst = findBySlug(slug);
      if (!inst) return;
      mutate((p) =>
        p.recentlyViewed[0] === inst.slug
          ? p // Already at the head; skip the write entirely.
          : {
              ...p,
              recentlyViewed: [
                inst.slug,
                ...p.recentlyViewed.filter((s) => s !== inst.slug),
              ].slice(0, LIMITS.recentlyViewed),
            },
      );
    },
    [mutate],
  );

  const noteFor = useCallback(
    (slug: string) => state.notes.find((n) => n.slug === slug),
    [state.notes],
  );

  const saveNote = useCallback(
    (slug: string, body: string) => {
      const inst = findBySlug(slug);
      if (!inst) return;
      const trimmed = body.trim().slice(0, 4000);

      mutate((p) => {
        // An emptied note is a deletion — keeping a blank record would clutter
        // the notes index and read as a bug.
        if (!trimmed) return { ...p, notes: p.notes.filter((n) => n.slug !== inst.slug) };

        const note: InstrumentNote = {
          slug: inst.slug,
          symbol: inst.symbol,
          body: trimmed,
          updatedAt: Date.now(),
        };
        const without = p.notes.filter((n) => n.slug !== inst.slug);
        return { ...p, notes: [note, ...without].slice(0, LIMITS.notes) };
      });
    },
    [mutate],
  );

  const removeNote = useCallback(
    (slug: string) => mutate((p) => ({ ...p, notes: p.notes.filter((n) => n.slug !== slug) })),
    [mutate],
  );

  const saveScreen = useCallback<PersonalContextValue["saveScreen"]>(
    (screen) => {
      const saved: SavedScreen = { ...screen, id: makeId("screen"), createdAt: Date.now() };
      mutate((p) => ({
        ...p,
        savedScreens: [saved, ...p.savedScreens].slice(0, LIMITS.savedScreens),
      }));
    },
    [mutate],
  );

  const removeScreen = useCallback(
    (id: string) => mutate((p) => ({ ...p, savedScreens: p.savedScreens.filter((s) => s.id !== id) })),
    [mutate],
  );

  /**
   * Record today's book value.
   *
   * Keyed by date so it is idempotent — the app calls this on every portfolio
   * view, and the day's entry is overwritten rather than duplicated. That
   * makes the history self-maintaining without a scheduled job.
   */
  const recordSnapshot = useCallback<PersonalContextValue["recordSnapshot"]>(
    (snapshot) => {
      mutate((p) => {
        const existing = p.snapshots.find((s) => s.date === snapshot.date);
        // Skip the write when nothing material moved — otherwise every render
        // of the portfolio page is a Firestore write.
        if (existing && Math.abs(existing.value - snapshot.value) < 0.01) return p;

        const next: PortfolioSnapshot = { ...snapshot, recordedAt: Date.now() };
        const without = p.snapshots.filter((s) => s.date !== snapshot.date);
        return {
          ...p,
          snapshots: [...without, next]
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-LIMITS.snapshots),
        };
      });
    },
    [mutate],
  );

  /**
   * Create or update a workspace. Returns the id either way, so the caller can
   * keep pointing at the layout it just saved without a round trip through
   * state.
   */
  const saveWorkspace = useCallback<PersonalContextValue["saveWorkspace"]>(
    (name, panes, id) => {
      const trimmed = name.trim().slice(0, 48) || "Untitled layout";
      const valid = panes.filter((p) => findBySlug(p.slug)).slice(0, LIMITS.panes);
      const workspaceId = id ?? makeId("ws");

      mutate((p) => {
        const existing = p.workspaces.find((w) => w.id === workspaceId);
        const next: Workspace = {
          id: workspaceId,
          name: trimmed,
          panes: valid,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        };
        const without = p.workspaces.filter((w) => w.id !== workspaceId);
        return { ...p, workspaces: [next, ...without].slice(0, LIMITS.workspaces) };
      });

      return workspaceId;
    },
    [mutate],
  );

  const removeWorkspace = useCallback(
    (id: string) => mutate((p) => ({ ...p, workspaces: p.workspaces.filter((w) => w.id !== id) })),
    [mutate],
  );

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
      recordView,
      noteFor,
      saveNote,
      removeNote,
      saveScreen,
      removeScreen,
      recordSnapshot,
      saveWorkspace,
      removeWorkspace,
    }),
    [
      state, ready, mode, migrated, isWatched, toggleWatch, addToWatchlist, removeFromWatchlist,
      reorderWatchlist, addPosition, updatePosition, removePosition, addAlert, updateAlert,
      removeAlert, markAlertTriggered, setPreference, resetAll, recordView, noteFor, saveNote,
      removeNote, saveScreen, removeScreen, recordSnapshot, saveWorkspace, removeWorkspace,
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
  const seenWatch = new Set(remote.watchlist);
  const seenRecent = new Set(remote.recentlyViewed);
  const seenNotes = new Set(remote.notes.map((n) => n.slug));
  const seenDates = new Set(remote.snapshots.map((s) => s.date));

  return {
    watchlist: [...remote.watchlist, ...local.watchlist.filter((s) => !seenWatch.has(s))],
    positions: [...remote.positions, ...local.positions],
    alerts: [...remote.alerts, ...local.alerts],
    preferences: { ...remote.preferences, ...local.preferences },
    recentlyViewed: [
      ...remote.recentlyViewed,
      ...local.recentlyViewed.filter((s) => !seenRecent.has(s)),
    ].slice(0, LIMITS.recentlyViewed),
    // The account's own note wins on a collision — it is the one the user has
    // seen most recently on their other devices.
    notes: [...remote.notes, ...local.notes.filter((n) => !seenNotes.has(n.slug))].slice(
      0,
      LIMITS.notes,
    ),
    savedScreens: [...remote.savedScreens, ...local.savedScreens].slice(0, LIMITS.savedScreens),
    snapshots: [...remote.snapshots, ...local.snapshots.filter((s) => !seenDates.has(s.date))]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-LIMITS.snapshots),
    workspaces: [...remote.workspaces, ...local.workspaces].slice(0, LIMITS.workspaces),
  };
}

export function usePersonal(): PersonalContextValue {
  const ctx = useContext(PersonalContext);
  if (!ctx) throw new Error("usePersonal must be used inside <PersonalProvider>");
  return ctx;
}
