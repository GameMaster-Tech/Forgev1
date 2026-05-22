"use client";

/**
 * Sidebar — flush dark rail. 56px wide. Sits against the page edge
 * (no floating margin). The brand mark anchors the top, a prominent
 * "+" quick-create button sits directly below it with a popover menu
 * (Document · Chat · Event · Project), then a short flat nav, then
 * theme/sign-out/avatar at the bottom.
 *
 * Quick-create routes:
 *   • Document → /projects (opens first project's "New document" flow)
 *   • Chat     → /research?new=1
 *   • Event    → /calendar?new=1
 *   • Project  → fires the onNewProject callback (legacy modal)
 *
 * Hover tooltips render on the right edge for the icon-only nav.
 */

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  FolderOpen,
  Users,
  Settings,
  Plus,
  Sun,
  Moon,
  LogOut,
  GitBranch,
  Activity,
  Calendar,
  History,
  FileText,
  MessageSquare,
  CalendarPlus,
  FolderPlus,
  Sparkles,
} from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";

const ease = [0.22, 0.61, 0.36, 1] as const;

const navItems: { href: string; icon: typeof Search; label: string }[] = [
  { href: "/research", icon: Search, label: "Research" },
  { href: "/projects", icon: FolderOpen, label: "Projects" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
  { href: "/preview", icon: Sparkles, label: "Preview" },
  { href: "/sync", icon: GitBranch, label: "Checks" },
  { href: "/pulse", icon: Activity, label: "Freshness" },
  { href: "/activity", icon: History, label: "Activity" },
  { href: "/teams", icon: Users, label: "Teams" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function RailTooltip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 translate-x-[-4px] group-hover:translate-x-0 transition-all duration-200 z-50">
      <div className="bg-foreground text-background text-[10px] font-medium uppercase tracking-[0.12em] px-2 py-1 whitespace-nowrap shadow-[0_8px_24px_-12px_rgba(0,0,0,0.45)] border border-white/10">
        {label}
      </div>
    </div>
  );
}

interface QuickCreateMenuProps {
  open: boolean;
  onClose: () => void;
  onNewProject?: () => void;
}

function QuickCreateMenu({ open, onClose, onNewProject }: QuickCreateMenuProps) {
  const router = useRouter();

  const items = [
    {
      icon: FileText,
      label: "Document",
      hint: "Start writing",
      onClick: () => {
        router.push("/projects?new=document");
        onClose();
      },
    },
    {
      icon: MessageSquare,
      label: "Chat",
      hint: "Ask the AI",
      onClick: () => {
        router.push("/research?new=1");
        onClose();
      },
    },
    {
      icon: CalendarPlus,
      label: "Event",
      hint: "Add to calendar",
      onClick: () => {
        router.push("/calendar?new=1");
        onClose();
      },
    },
    {
      icon: FolderPlus,
      label: "Project",
      hint: "Brand new workspace",
      onClick: () => {
        onNewProject?.();
        onClose();
      },
    },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
          <motion.div
            initial={{ opacity: 0, x: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease }}
            className="absolute left-full ml-3 top-0 z-50 w-60 bg-foreground text-background border border-white/10 shadow-[0_24px_56px_-20px_rgba(0,0,0,0.55)] overflow-hidden"
          >
            <div className="px-4 pt-3 pb-2 border-b border-white/10">
              <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-semibold">
                Create
              </span>
            </div>
            <ul className="py-1">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={item.onClick}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.06] transition-colors group"
                    >
                      <div className="w-7 h-7 bg-white/[0.06] border border-white/10 flex items-center justify-center group-hover:bg-violet/20 group-hover:border-violet/40 transition-colors">
                        <Icon size={12} strokeWidth={2} className="text-background/80 group-hover:text-violet" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-background font-medium">{item.label}</div>
                        <div className="text-[10px] text-background/55 mt-0.5">{item.hint}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export default function Sidebar({
  onNewProject,
}: {
  onNewProject?: () => void;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const closeOnRouteChangeRef = useRef(pathname);
  useEffect(() => {
    if (pathname !== closeOnRouteChangeRef.current) {
      closeOnRouteChangeRef.current = pathname;
      setCreateOpen(false);
    }
  }, [pathname]);

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "U";

  return (
    <motion.aside
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease }}
      className="w-[56px] shrink-0 flex flex-col h-full bg-foreground text-background relative border-r border-white/[0.07]"
    >
      {/* Brand mark */}
      <div className="relative h-14 flex items-center justify-center shrink-0 border-b border-white/[0.07]">
        <Link
          href="/research"
          aria-label="Forge"
          className="group relative w-8 h-8 bg-violet flex items-center justify-center hover:bg-violet/90 transition-colors duration-200"
        >
          <span className="font-display font-black text-white text-[13px] leading-none">
            F
          </span>
        </Link>
      </div>

      {/* Quick-create button + popover menu */}
      <div className="relative px-2 pt-3 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => setCreateOpen((v) => !v)}
          aria-label="Create"
          aria-expanded={createOpen}
          className={`group relative w-full h-9 flex items-center justify-center transition-colors duration-150 ${
            createOpen ? "bg-violet/90" : "bg-violet hover:bg-violet/90"
          } text-white`}
        >
          <Plus
            size={14}
            strokeWidth={2.25}
            className={`transition-transform duration-200 ${createOpen ? "rotate-45" : ""}`}
          />
          {!createOpen ? <RailTooltip label="Create" /> : null}
        </button>
        <QuickCreateMenu
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onNewProject={onNewProject}
        />
      </div>

      {/* Nav */}
      <nav className="relative flex-1 px-2 pt-1 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center justify-center w-full h-9 transition-colors duration-150 ${
                active
                  ? "text-background bg-white/[0.08]"
                  : "text-background/55 hover:text-background hover:bg-white/[0.05]"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-rail-indicator"
                  transition={{ duration: 0.22, ease }}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-violet"
                />
              )}
              <Icon size={15} strokeWidth={active ? 2.25 : 1.75} />
              <RailTooltip label={item.label} />
            </Link>
          );
        })}
      </nav>

      {/* Footer cluster */}
      <div className="relative px-2 pt-2 pb-3 shrink-0 space-y-0.5 border-t border-white/[0.07]">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="group relative flex items-center justify-center w-full h-9 text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors duration-150"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          <RailTooltip label={theme === "dark" ? "Light mode" : "Dark mode"} />
        </button>

        <button
          onClick={() => logout()}
          aria-label="Sign out"
          className="group relative flex items-center justify-center w-full h-9 text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors duration-150"
        >
          <LogOut size={14} />
          <RailTooltip label="Sign out" />
        </button>

        <div className="h-px bg-white/[0.08] mx-1.5 my-1.5" />

        <Link
          href="/settings"
          className="group relative flex items-center justify-center pt-0.5"
          aria-label="Account settings"
        >
          <div className="w-8 h-8 bg-violet text-white flex items-center justify-center">
            <span className="text-[10px] font-semibold font-display tabular-nums">
              {initials}
            </span>
          </div>
          <RailTooltip label={user?.displayName || user?.email || "Account"} />
        </Link>
      </div>
    </motion.aside>
  );
}
