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
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { firebaseAuth, firebaseAuthErrorMessage, isFirebaseConfigured } from "@/lib/firebase/client";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the first auth state resolution. Gate redirects on this. */
  loading: boolean;
  /** False when the Firebase project has not been configured. */
  configured: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Thrown with copy already fit for display. */
export class AuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AuthError";
  }
}

function toAuthError(err: unknown): AuthError {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);
    return new AuthError(firebaseAuthErrorMessage(code), code);
  }
  if (err instanceof Error) return new AuthError(err.message);
  return new AuthError("Something went wrong. Please try again.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(configured);
  const lastSyncedToken = useRef<string | null>(null);

  /**
   * Mirror the client's ID token into an httpOnly session cookie.
   *
   * `onIdTokenChanged` (rather than `onAuthStateChanged`) fires on the hourly
   * silent refresh too, so the cookie is kept alive for as long as the tab is
   * open without the user ever re-authenticating.
   */
  const syncSession = useCallback(async (fbUser: User | null) => {
    try {
      if (!fbUser) {
        if (lastSyncedToken.current !== null) {
          lastSyncedToken.current = null;
          await fetch("/api/session", { method: "DELETE" });
        }
        return;
      }
      const idToken = await fbUser.getIdToken();
      if (idToken === lastSyncedToken.current) return;
      lastSyncedToken.current = idToken;
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
    } catch {
      // The cookie is an optimisation for server rendering. If minting fails
      // — most often because Admin credentials are absent — client-side auth
      // still works and the app stays usable.
    }
  }, []);

  useEffect(() => {
    const auth = firebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsub = onIdTokenChanged(auth, (fbUser) => {
      setUser(
        fbUser
          ? {
              uid: fbUser.uid,
              email: fbUser.email,
              displayName: fbUser.displayName,
              photoURL: fbUser.photoURL,
              emailVerified: fbUser.emailVerified,
            }
          : null,
      );
      setLoading(false);
      void syncSession(fbUser);
    });

    return unsub;
  }, [syncSession]);

  const requireAuth = useCallback(() => {
    const auth = firebaseAuth();
    if (!auth) {
      throw new AuthError(
        "Firebase isn't configured yet. Add your project keys to enable accounts — everything else works without them.",
        "app/not-configured",
      );
    }
    return auth;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const auth = requireAuth();
      try {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName?.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
          setUser((u) => (u ? { ...u, displayName: displayName.trim() } : u));
        }
        await syncSession(cred.user);
      } catch (err) {
        throw toAuthError(err);
      }
    },
    [requireAuth, syncSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const auth = requireAuth();
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        await syncSession(cred.user);
      } catch (err) {
        throw toAuthError(err);
      }
    },
    [requireAuth, syncSession],
  );

  const signInWithGoogle = useCallback(async () => {
    const auth = requireAuth();
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(auth, provider);
      await syncSession(cred.user);
    } catch (err) {
      throw toAuthError(err);
    }
  }, [requireAuth, syncSession]);

  const signOut = useCallback(async () => {
    const auth = firebaseAuth();
    lastSyncedToken.current = null;
    try {
      await fetch("/api/session", { method: "DELETE" });
    } catch {
      /* clearing the cookie is best-effort */
    }
    if (auth) await fbSignOut(auth);
    setUser(null);
  }, []);

  const resetPassword = useCallback(
    async (email: string) => {
      const auth = requireAuth();
      try {
        await sendPasswordResetEmail(auth, email.trim());
      } catch (err) {
        throw toAuthError(err);
      }
    },
    [requireAuth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, configured, signUp, signIn, signInWithGoogle, signOut, resetPassword }),
    [user, loading, configured, signUp, signIn, signInWithGoogle, signOut, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
