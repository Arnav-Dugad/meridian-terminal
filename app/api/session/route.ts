import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  createSessionCookie,
  isAdminConfigured,
  revokeAllSessions,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  verifySessionCookie,
} from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ idToken: z.string().min(20).max(4096) });

/**
 * Exchange a Firebase ID token for an httpOnly session cookie.
 *
 * The ID token lives in JavaScript and expires in an hour; the session cookie
 * is unreadable from JavaScript and lasts two weeks. Trading the first for the
 * second is what lets server components render authenticated pages directly,
 * and it removes the XSS-exfiltration path that storing tokens in
 * localStorage would open.
 */
export async function POST(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured on the server." },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "An idToken is required" }, { status: 400 });
  }

  try {
    const cookie = await createSessionCookie(parsed.data.idToken);
    if (!cookie) throw new Error("Session cookie could not be minted");

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE,
      value: cookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });
    return res;
  } catch (err) {
    // A rejected token is the normal failure here (expired, or minted by a
    // different Firebase project), so respond 401 rather than 500.
    const message = err instanceof Error ? err.message : "Sign-in failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/** Sign out: clear the cookie and revoke refresh tokens across devices. */
export async function DELETE(req: NextRequest) {
  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  const decoded = await verifySessionCookie(existing);
  if (decoded?.uid) await revokeAllSessions(decoded.uid);

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

/** Who am I? Used by the client to reconcile after a cold navigation. */
export async function GET(req: NextRequest) {
  const decoded = await verifySessionCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (!decoded) return NextResponse.json({ user: null }, { headers: { "Cache-Control": "no-store" } });

  return NextResponse.json(
    {
      user: {
        uid: decoded.uid,
        email: decoded["email"] ?? null,
        name: decoded["name"] ?? null,
        picture: decoded["picture"] ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
