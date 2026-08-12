"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/firebase/auth-context";
import { PersonalProvider } from "@/lib/store/personal";
import { MarketDataProvider } from "@/lib/hooks/market-data";
import { CommandPaletteProvider } from "@/components/shell/CommandPalette";

export function Providers({ children }: { children: ReactNode }) {
  return (
    // `reducedMotion="user"` makes every Framer animation defer to the OS
    // setting without a single per-component check.
    <MotionConfig reducedMotion="user" transition={{ ease: [0.16, 1, 0.3, 1] }}>
      <LazyMotion features={domAnimation} strict={false}>
        <AuthProvider>
          <PersonalProvider>
            <MarketDataProvider>
              <CommandPaletteProvider>{children}</CommandPaletteProvider>
            </MarketDataProvider>
          </PersonalProvider>
        </AuthProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
