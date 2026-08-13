import type { Metadata } from "next";

import { ActionsView } from "@/components/views/ActionsView";

export const metadata: Metadata = {
  title: "Corporate actions",
  description: "Upcoming dividends, splits, bonuses and buybacks on the Indian market.",
};

export default function ActionsPage() {
  return <ActionsView />;
}