import type { Metadata } from "next";

import { AlertsView } from "@/components/views/AlertsView";

export const metadata: Metadata = {
  title: "Alerts",
  description: "Price triggers on NSE and US listings, evaluated against the live stream.",
};

export default function AlertsPage() {
  return <AlertsView />;
}
