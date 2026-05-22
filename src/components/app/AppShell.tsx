"use client";

import { useState } from "react";
import Sidebar from "@/components/app/Sidebar";
import MobileBottomNav from "@/components/app/MobileBottomNav";
import NewProjectModal from "@/components/app/NewProjectModal";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PresenceStrip } from "@/components/collab/PresenceStrip";
import { CursorOverlay } from "@/components/collab/CursorOverlay";
import { usePresence } from "@/hooks/usePresence";
import { Tutorial } from "@/components/onboarding/Tutorial";
import { useGlobalCommands } from "@/hooks/useGlobalCommands";

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
  // Global "personal" doc id so PresenceStrip is always live. Each
  // page can mount its own useCollab for a feature-scoped doc.
  const { peers } = usePresence({ kind: "lattice-tree", projectId: "personal", resourceId: "shell" });
  // Register the global Cmd-K command set (nav + create + projects).
  useGlobalCommands({ onNewProject: () => setShowNewProject(true) });

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground">
      {/* Skip-to-content — visible only when focused via keyboard. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-violet focus:text-white focus:px-4 focus:py-2 focus:text-[12px] focus:font-semibold focus:uppercase focus:tracking-[0.12em]"
      >
        Skip to main content
      </a>
      {/* Flush dark rail — desktop only */}
      <div className="hidden md:block shrink-0 sticky top-0 h-screen z-30">
        <Sidebar onNewProject={() => setShowNewProject(true)} />
      </div>
      <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-auto pb-16 md:pb-0 focus:outline-none">
        {children}
      </main>
      {/* Floating top-right cluster: presence strip + notification bell.
          Both desktop-only; mobile gets the bell only via in-app bell
          surface inside MobileBottomNav (TBD). */}
      <div className="hidden md:flex fixed top-4 right-4 z-40 items-center gap-2">
        <PresenceStrip peers={peers} />
        <NotificationBell />
      </div>
      {/* Remote screen cursors (Lattice / Sync / Calendar surfaces). */}
      <CursorOverlay peers={peers} />
      <MobileBottomNav onNewProject={() => setShowNewProject(true)} />
      <NewProjectModal
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
      />
      <CommandPalette />
      <Tutorial />
    </div>
  );
}
