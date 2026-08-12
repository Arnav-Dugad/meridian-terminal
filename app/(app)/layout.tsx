import { AppShell } from "@/components/shell/AppShell";

/**
 * Every terminal route renders inside the shell.
 *
 * Note that there is no auth gate here. The product is deliberately usable
 * signed out — watchlist, portfolio and alerts all persist locally and are
 * lifted into the account on first sign-in. Gating the terminal behind a login
 * wall would make the most persuasive part of the product invisible until
 * after someone has already committed to it.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
