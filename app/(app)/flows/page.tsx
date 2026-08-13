import type { Metadata } from "next";

import { FlowsView } from "@/components/views/FlowsView";

export const metadata: Metadata = {
  title: "Institutional flows",
  description:
    "Daily foreign and domestic institutional buying and selling on the Indian market, with accumulated history.",
};

export default function FlowsPage() {
  return <FlowsView />;
}
