"use client";

/**
 * Sidebar — floating dark rail. 56px wide. Deep ink (foreground)
 * background against the cream canvas — same pairing the landing
 * page hero uses. Hairline border, padded from
 * the page edges via AppShell's wrapper.
 *
 * Hover tooltips render on the right edge for the icon-only nav.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";

const ease = [0.22, 0.61, 0.36, 1] as const;

const navItems: { href: string; icon: typeof Search; label: string }[] = [
  { href: "/research", icon: Search, label: "Research" },
  { href: "/projects", icon: FolderOpen, label: "Projects" },
  { href: "/sync", icon: GitBranch, label: "Sync" },
  { href: "/pulse", icon: Activity, label: "Pulse" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
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

export default function Sidebar({
  onNewProject,
}: {
  onNewProject?: () => void;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

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
      className="w-[56px] shrink-0 flex flex-col h-full bg-foreground text-background relative overflow-hidden shadow-[0_18px_44px_-18px_rgba(0,0,0,0.45)]"
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

      {/* New project — primary CTA */}
      <div className="relative px-2 pt-3 pb-2 shrink-0">
        <button
          onClick={onNewProject}
          aria-label="New project"
          className="group relative w-full h-9 bg-violet text-white flex items-center justify-center hover:bg-violet/90 transition-colors duration-150"
        >
          <Plus size={14} strokeWidth={2.25} />
          <RailTooltip label="New project" />
        </button>
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

        <div className="group relative flex items-center justify-center pt-0.5">
          <div className="w-8 h-8 bg-violet text-white flex items-center justify-center">
            <span className="text-[10px] font-semibold font-display tabular-nums">
              {initials}
            </span>
          </div>
          <RailTooltip label={user?.displayName || user?.email || "Account"} />
        </div>
      </div>
    </motion.aside>
  );
}
