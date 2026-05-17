"use client";

import { useState } from "react";
import Sidebar from "@/components/app/Sidebar";
import MobileBottomNav from "@/components/app/MobileBottomNav";
import NewProjectModal from "@/components/app/NewProjectModal";

/**
 * AppShell — floating dark sidebar on desktop, bottom bar on mobile.
 *
 * Above 768px the desktop rail floats with 12px margin all around so
 * the dark frame reads as a confident object on the cream page. Below
 * that we collapse to a fixed bottom bar (iOS-style) — the rail is
 * too thin to be useful on a 375px screen and steals horizontal real
 * estate the content desperately needs.
 *
 * `pb-16 md:pb-0` keeps the main scroll area clear of the bottom bar
 * on mobile.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [showNewProject, setShowNewProject] = useState(false);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground">
      {/* Floating dark rail — desktop only */}
      <div className="hidden md:block shrink-0 sticky top-0 h-screen z-30 p-3">
        <Sidebar onNewProject={() => setShowNewProject(true)} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto pb-16 md:pb-0">{children}</main>
      <MobileBottomNav onNewProject={() => setShowNewProject(true)} />
      <NewProjectModal
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
      />
    </div>
  );
}
