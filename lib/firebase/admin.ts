import "server-only";

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Server-side Firebase.
 *
 * Used for one job: turning a short-lived client ID token into an httpOnly,
 * SameSite=Lax session cookie that server components can verify without a
 * round trip to the client. That is what makes authenticated pages renderable
 * on the server — the alternative, reading auth state in the browser and then
 * fetching, produces a visible unauthenticated flash on every navigation.
 *
 * Credentials are read from either three discrete vars or one JSON blob,
 * because the two hosting providers people actually use disagree about which
 * is convenient.
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
      const text = blob.startsWith("{")
        ? blob
        : Buffer.from(blob, "base64").toString("utf8");
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
 * literal `\n`. Some dashboards additionally wrap the whole value in quotes.
 */
function normaliseKey(key: string): string {
  let k = key.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, "\n");
}

let cachedApp: App | null | undefined;

function adminApp(): App | null {
  if (cachedApp !== undefined) return cachedApp;

  const sa = readServiceAccount();
  if (!sa) {
    cachedApp = null;
    return null;
  }

  try {
    cachedApp = getApps().length
      ? getApp()
      : initializeApp({
          credential: cert({
            projectId: sa.projectId,
            clientEmail: sa.clientEmail,
            privateKey: sa.privateKey,
          }),
          projectId: sa.projectId,
        });
  } catch (err) {
    console.error("[firebase-admin] initialisation failed:", err);
    cachedApp = null;
  }
  return cachedApp;
}

export function isAdminConfigured(): boolean {
  return adminApp() !== null;
}

export function adminAuth(): Auth | null {
  const app = adminApp();
  return app ? getAuth(app) : null;
}

export function adminDb(): Firestore | null {
  const app = adminApp();
  return app ? getFirestore(app) : null;
}

/** Fourteen days, matching the maximum Firebase allows for session cookies. */
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "meridian_session";

export async function createSessionCookie(idToken: string): Promise<string | null> {
  const auth = adminAuth();
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
  const auth = adminAuth();
  if (!auth) return null;
  try {
    return await auth.verifySessionCookie(cookie, checkRevoked);
  } catch {
    return null;
  }
}

export async function revokeAllSessions(uid: string): Promise<void> {
  const auth = adminAuth();
  if (!auth) return;
  try {
    await auth.revokeRefreshTokens(uid);
  } catch {
    /* best effort — the cookie is cleared regardless */
  }
}
