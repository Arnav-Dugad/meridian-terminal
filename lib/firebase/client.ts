"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

/**
 * Browser-side Firebase.
 *
 * Every accessor returns `null` rather than throwing when the project is not
 * configured. That is a deliberate product decision: the terminal has to be
 * fully usable — watchlists, portfolios, alerts and all — before anyone sets
 * up a Firebase project, so the personal-data layer falls back to local
 * storage instead of erroring. See `lib/store/personal.ts`.
 */

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId && config.authDomain);
}

let appRef: FirebaseApp | null = null;
let authRef: Auth | null = null;
let dbRef: Firestore | null = null;

export function firebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (appRef) return appRef;
  appRef = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: config.apiKey!,
        authDomain: config.authDomain!,
        projectId: config.projectId!,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId!,
      });
  return appRef;
}

export function firebaseAuth(): Auth | null {
  if (authRef) return authRef;
  const app = firebaseApp();
  if (!app) return null;
  authRef = getAuth(app);
  // Survive a tab close; the session cookie is refreshed from this on return.
  void setPersistence(authRef, browserLocalPersistence).catch(() => {
    /* private browsing — in-memory persistence is an acceptable fallback */
  });
  return authRef;
}

export function firebaseDb(): Firestore | null {
  if (dbRef) return dbRef;
  const app = firebaseApp();
  if (!app) return null;
  try {
    // IndexedDB-backed cache with multi-tab coordination: watchlist edits made
    // offline reconcile on reconnect, and a second tab does not fight for the
    // lease.
    dbRef = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // initializeFirestore throws if the instance already exists (fast refresh).
    dbRef = getFirestore(app);
  }
  return dbRef;
}

/** Human-readable copy for the auth surfaces. */
export function firebaseAuthErrorMessage(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already exists with this email.";
    case "auth/weak-password":
      return "Choose a password of at least 8 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in window was closed before finishing.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window.";
    case "auth/account-exists-with-different-credential":
      return "That email is already registered with a different sign-in method.";
    case "auth/network-request-failed":
      return "Network problem — check your connection and retry.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't enabled on this Firebase project.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorised in the Firebase console.";
    default:
      return "Something went wrong signing you in. Please try again.";
  }
}
