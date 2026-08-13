import type { Metadata } from "next";

import { WorkspaceView } from "@/components/views/WorkspaceView";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Four live charts on one screen, saved as named layouts.",
};

export default function WorkspacePage() {
  return <WorkspaceView />;
}
