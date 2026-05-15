"use client";

import { useState } from "react";
import Sidebar from "@/components/app/Sidebar";
import NewProjectModal from "@/components/app/NewProjectModal";

/**
 * AppShell — floating dark sidebar + cream canvas.
 *
 * The sidebar floats with 12px margin all around so the dark rail reads
 * as a confident object on the cream page, not a wall glued to the edge.
 * Same dark/cream pairing the marketing-page hero uses — keeps brand
 * coherence end-to-end without inventing new tokens.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [showNewProject, setShowNewProject] = useState(false);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Floating dark rail — padded from edges */}
      <div className="shrink-0 sticky top-0 h-screen z-30 p-3">
        <Sidebar onNewProject={() => setShowNewProject(true)} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      <NewProjectModal
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
      />
    </div>
  );
}
