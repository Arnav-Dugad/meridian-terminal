import type { Metadata } from "next";

import { DealsView } from "@/components/views/DealsView";

export const metadata: Metadata = {
  title: "Bulk & block deals",
  description:
    "Large disclosed trades on the Indian market — which institution bought or sold what, and at what price.",
};

export default function DealsPage() {
  return <DealsView />;
}