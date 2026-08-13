import type { Metadata } from "next";

import { DiagnosticsView } from "@/components/views/DiagnosticsView";

export const metadata: Metadata = {
  title: "Diagnostics",
  description: "Live health probes for every configured market-data provider.",
  robots: { index: false, follow: false },
};

export default function DiagnosticsPage() {
  return <DiagnosticsView />;
}
