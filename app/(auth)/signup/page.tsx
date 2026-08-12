import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Meridian account to sync your watchlist, portfolio and alerts.",
};

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
