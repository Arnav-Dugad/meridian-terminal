"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "motion/react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/primitives";
import { Wordmark } from "@/components/brand/Wordmark";

const LINKS = [
  { href: "#thesis", label: "The thesis" },
  { href: "#terminal", label: "Terminal" },
  { href: "#engineering", label: "Engineering" },
];

export function LandingNav() {
  const { user, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  const borderOpacity = useTransform(scrollY, [0, 90], [0, 1]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter] duration-300",
        scrolled ? "bg-ink-950/78 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      {/* The rule fades in with scroll rather than snapping on a threshold. */}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-px bg-line-strong"
        style={{ opacity: borderOpacity }}
      />

      <nav className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Meridian home">
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm px-3 py-2 text-[13px] text-ivory-60 transition-colors duration-150 hover:text-ivory"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-9 w-[168px]" aria-hidden />
          ) : user ? (
            <Link href="/dashboard">
              <Button variant="primary" size="md">
                Open terminal
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden sm:block">
                <Button variant="ghost" size="md">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button variant="primary" size="md">
                  Create account
                </Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </motion.header>
  );
}
