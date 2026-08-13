import type { Metadata } from "next";

import { SettingsView } from "@/components/views/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
  description: "Theme, markets, charts, alerts and your data.",
};

export default function SettingsPage() {
  return <SettingsView />;
}
