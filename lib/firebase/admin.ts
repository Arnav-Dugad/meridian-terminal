import "server-only";

import type { App } from "firebase-admin/app";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";

/**
 * Server-side Firebase.
 *
 * Used for one job: turning a short-lived client ID token into an httpOnly,
 * SameSite=Lax session cookie that server components can verify without a
 * round trip to the client. That is what makes authenticated pages renderable
 * on the server — the alternative, reading auth state in the browser and then
 * fetching, produces a visible unauthenticated flash on every navigation.
 *
 * ── Why every import here is dynamic ────────────────────────────────────────
 * `firebase-admin` pulls in optional native and gRPC dependencies. A static
 * top-level import means that if the package fails to resolve inside a
 * serverless bundle, the *module* throws during evaluation — before any of the
 * guard code below can run — and every route that touches it returns a bare
 * 500 with an empty body. That is exactly what happened in production.
 *
 * Loading it lazily inside an async initialiser moves the failure from module
 * evaluation into a try/catch we control, so a broken or absent Admin SDK
 * degrades to "sessions unavailable" instead of taking down /api/health and
 * /api/session. Only the *types* are imported statically, which erase at
 * compile time and cost nothing at runtime.
 */

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function readServiceAccount(): ServiceAccount | null {
  const blob = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (blob) {
    try {
      // Accept raw JSON or base64 — pasting a multi-line key into a dashboard
      // field mangles it often enough that both forms are worth supporting.
      const text = blob.startsWith("{") ? blob : Buffer.from(blob, "base64").toString("utf8");
      const parsed = JSON.parse(text) as Record<string, string>;
      const projectId = parsed["project_id"] ?? parsed["projectId"];
      const clientEmail = parsed["client_email"] ?? parsed["clientEmail"];
      const privateKey = parsed["private_key"] ?? parsed["privateKey"];
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey: normaliseKey(privateKey) };
      }
    } catch {
      /* fall through to the discrete vars */
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKey) return null;

  return { projectId, clientEmail, privateKey: normaliseKey(privateKey) };
}

/**
 * Environment files cannot hold real newlines, so private keys are stored with
 * literal `\n`. Some dashboards additionally wrap the value in quotes, and
 * copy-paste through a terminal can leave `\r` behind — all three are common
 * enough in practice to normalise rather than diagnose.
 */
function normaliseKey(key: string): string {
  let k = key.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, "\n").replace(/\r/g, "");
}

/** Set once initialisation has been attempted, successful or not. */
let initPromise: Promise<App | null> | null = null;
let lastError: string | null = null;

async function adminApp(): Promise<App | null> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sa = readServiceAccount();
    if (!sa) {
      lastError = "no service-account credentials configured";
      return null;
    }

    try {
      const { cert, getApp, getApps, initializeApp } = await import("firebase-admin/app");
      if (getApps().length) return getApp();

      return initializeApp({
        credential: cert({
          projectId: sa.projectId,
          clientEmail: sa.clientEmail,
          privateKey: sa.privateKey,
        }),
        projectId: sa.projectId,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "unknown initialisation failure";
      console.error("[firebase-admin] initialisation failed:", err);
      return null;
    }
  })();

  return initPromise;
}

/** Reports whether server-side auth is usable, and why not when it isn't. */
export async function adminStatus(): Promise<{ configured: boolean; reason: string | null }> {
  const app = await adminApp();
  return { configured: app !== null, reason: app ? null : lastError };
}

export async function isAdminConfigured(): Promise<boolean> {
  return (await adminApp()) !== null;
}

export async function adminAuth(): Promise<Auth | null> {
  const app = await adminApp();
  if (!app) return null;
  try {
    const { getAuth } = await import("firebase-admin/auth");
    return getAuth(app);
  } catch (err) {
    console.error("[firebase-admin] getAuth failed:", err);
    return null;
  }
}

/** Fourteen days, the maximum Firebase allows for a session cookie. */
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "meridian_session";

export async function createSessionCookie(idToken: string): Promise<string | null> {
  const auth = await adminAuth();
  if (!auth) return null;
  return auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
}

/**
 * Verify a session cookie. `checkRevoked` costs a round trip to Google but
 * means a signed-out or disabled account loses access immediately rather than
 * whenever the cookie happens to expire.
 */
export async function verifySessionCookie(
  cookie: string | undefined,
  { checkRevoked = false } = {},
): Promise<DecodedIdToken | null> {
  if (!cookie) return null;
  const auth = await adminAuth();
  if (!auth) return null;
  try {
    return await auth.verifySessionCookie(cookie, checkRevoked);
  } catch {
    return null;
  }
}

export async function revokeAllSessions(uid: string): Promise<void> {
  const auth = await adminAuth();
  if (!auth) return;
  try {
    await auth.revokeRefreshTokens(uid);
  } catch {
    /* best effort — the cookie is cleared regardless */
  }
}
