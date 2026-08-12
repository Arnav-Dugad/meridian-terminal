"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useAuth } from "@/lib/firebase/auth-context";
import { Button, Input } from "@/components/ui/primitives";
import { IconEye, IconEyeOff, IconGoogle, IconLock, IconMail, IconUser } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

/**
 * The sign-in and sign-up form.
 *
 * One component for both modes, because they differ by two fields and a verb;
 * two near-identical files would drift. The mode swap animates rather than
 * remounting, so the email a visitor already typed survives the switch.
 *
 * The password strength read-out is deliberately advisory, not blocking.
 * Firebase enforces a six-character floor; this nudges toward something better
 * without inventing rules that make people write `Password1!` and reuse it.
 */
/**
 * `useSearchParams` opts a component out of static rendering unless it sits
 * under a Suspense boundary, so the boundary lives here rather than being
 * duplicated in both route files. The fallback mirrors the form's geometry to
 * avoid a layout shift on hydration.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  return (
    <Suspense fallback={<AuthFormFallback mode={mode} />}>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}

function AuthFormFallback({ mode }: { mode: Mode }) {
  const isSignup = mode === "signup";
  return (
    <div aria-hidden>
      <h1 className="display text-[34px] text-ivory">
        {isSignup ? "Open an account" : "Welcome back"}
      </h1>
      <div className="mt-3 h-9 w-full" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: isSignup ? 3 : 2 }, (_, i) => (
          <div key={i} className="h-[62px] rounded-sm bg-ink-900" />
        ))}
        <div className="h-11 rounded-sm bg-ink-850" />
      </div>
    </div>
  );
}

function AuthFormInner({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp, signInWithGoogle, resetPassword, user, loading, configured } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"form" | "google" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const next = searchParams.get("next") ?? "/dashboard";
  const isSignup = mode === "signup";

  // Already authenticated visitors should not sit on a login form.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, router, next]);

  const strength = useMemo(() => scorePassword(password), [password]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim()) return setError("Enter your email address.");
    if (password.length < 6) return setError("Passwords must be at least 6 characters.");

    setBusy("form");
    try {
      if (isSignup) await signUp(email, password, name);
      else await signIn(email, password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setNotice(null);
    setBusy("google");
    try {
      await signInWithGoogle();
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onReset() {
    if (!email.trim()) {
      setError("Enter your email address first, then request a reset.");
      return;
    }
    setError(null);
    setBusy("reset");
    try {
      await resetPassword(email);
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a reset email.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="display text-[34px] text-ivory">
            {isSignup ? "Open an account" : "Welcome back"}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ivory-60">
            {isSignup
              ? "Sync your watchlist, portfolio and alerts across every device you sign in on."
              : "Pick up where you left off — your book and alerts are waiting."}
          </p>
        </motion.div>
      </AnimatePresence>

      {!configured && (
        <div className="mt-6 rounded-sm border border-signal/30 bg-signal/[0.06] p-3.5">
          <p className="label-micro text-signal">Accounts not configured</p>
          <p className="mt-2 text-[12px] leading-relaxed text-ivory-60">
            This deployment has no Firebase project attached, so sign-in is unavailable.
            Everything else works —{" "}
            <Link href="/dashboard" className="text-ivory underline underline-offset-2">
              open the terminal
            </Link>{" "}
            and your watchlist, portfolio and alerts will be saved on this device.
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {isSignup && (
          <Input
            label="Name"
            type="text"
            autoComplete="name"
            placeholder="Arnav Dugad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            leading={<IconUser />}
            disabled={!configured}
          />
        )}

        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leading={<IconMail />}
          disabled={!configured}
        />

        <div>
          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={6}
            placeholder={isSignup ? "At least 8 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leading={<IconLock />}
            disabled={!configured}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="text-ivory-40 transition-colors hover:text-ivory-80"
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            }
          />

          {isSignup && password.length > 0 && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="flex h-[3px] flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    className={cn(
                      "flex-1 rounded-full",
                      i < strength.score ? strength.barClass : "bg-ink-700",
                    )}
                    initial={false}
                    animate={{ opacity: i < strength.score ? 1 : 0.5 }}
                    transition={{ duration: 0.2 }}
                  />
                ))}
              </div>
              <span className={cn("label-micro-tight", strength.textClass)}>{strength.label}</span>
            </div>
          )}
        </div>

        <AnimatePresence>
          {(error || notice) && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              role="alert"
              className={cn(
                "overflow-hidden rounded-sm border px-3 py-2.5 text-[12px] leading-relaxed",
                error
                  ? "border-down/35 bg-down/[0.07] text-down"
                  : "border-up/35 bg-up/[0.07] text-up",
              )}
            >
              {error ?? notice}
            </motion.p>
          )}
        </AnimatePresence>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy === "form"}
          disabled={!configured}
        >
          {isSignup ? "Create account" : "Sign in"}
        </Button>

        {!isSignup && (
          <button
            type="button"
            onClick={onReset}
            disabled={!configured || busy !== null}
            className="w-full text-center text-[12px] text-ivory-40 transition-colors hover:text-ivory-80 disabled:opacity-50"
          >
            {busy === "reset" ? "Sending…" : "Forgot your password?"}
          </button>
        )}
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="label-micro-tight text-ivory-40">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={onGoogle}
        loading={busy === "google"}
        disabled={!configured}
        icon={busy === "google" ? undefined : <IconGoogle />}
      >
        Continue with Google
      </Button>

      <p className="mt-8 text-center text-[13px] text-ivory-60">
        {isSignup ? "Already have an account?" : "New to Meridian?"}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="text-ivory underline decoration-line-bright underline-offset-4 transition-colors hover:decoration-signal"
        >
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

/* ── Password strength ────────────────────────────────────────────────────── */

interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  barClass: string;
  textClass: string;
}

/**
 * A length-first heuristic. Character-class rules produce `P@ssw0rd`, which is
 * weak; length produces passphrases, which are not. Common-password shapes are
 * penalised outright.
 */
function scorePassword(password: string): Strength {
  if (!password) return { score: 0, label: "", barClass: "bg-ink-700", textClass: "text-ivory-40" };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[^A-Za-z0-9]/.test(password) && /\d/.test(password)) score++;

  if (/^[a-z]+$/i.test(password) && password.length < 12) score = Math.min(score, 1);
  if (/^(password|qwerty|12345|letmein|admin)/i.test(password)) score = 0;

  const clamped = Math.max(0, Math.min(4, score)) as Strength["score"];

  const table: Record<Strength["score"], Omit<Strength, "score">> = {
    0: { label: "Too weak", barClass: "bg-down", textClass: "text-down" },
    1: { label: "Weak", barClass: "bg-down", textClass: "text-down" },
    2: { label: "Fair", barClass: "bg-signal", textClass: "text-signal" },
    3: { label: "Strong", barClass: "bg-up", textClass: "text-up" },
    4: { label: "Excellent", barClass: "bg-up", textClass: "text-up" },
  };

  return { score: clamped, ...table[clamped] };
}
