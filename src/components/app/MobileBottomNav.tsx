"use client";

/**
 * MobileBottomNav — fixed bottom rail for <768px screens.
 *
 * Mirrors the primary nav from the desktop sidebar (Research, Projects,
 * Sync, Pulse, Calendar) and lifts the New-project CTA into the centre
 * slot. Settings + Teams are reachable from the settings page itself,
 * keeping this bar to the five highest-traffic routes.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  FolderOpen,
  Plus,
  GitBranch,
  Activity,
  Calendar,
} from "lucide-react";

const items: { href: string; icon: typeof Search; label: string }[] = [
  { href: "/research", icon: Search,      label: "Research" },
  { href: "/projects", icon: FolderOpen,  label: "Projects" },
  { href: "/sync",     icon: GitBranch,   label: "Sync" },
  { href: "/pulse",    icon: Activity,    label: "Pulse" },
  { href: "/calendar", icon: Calendar,    label: "Calendar" },
];

export default function MobileBottomNav({ onNewProject }: { onNewProject?: () => void }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-foreground text-background border-t border-white/[0.07] flex items-center justify-around h-14"
    >
      {items.slice(0, 2).map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
      <button
        type="button"
        onClick={onNewProject}
        aria-label="New project"
        className="bg-violet text-white w-12 h-12 -mt-6 flex items-center justify-center shadow-[0_8px_22px_-10px_rgba(0,0,0,0.55)] hover:bg-violet/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 transition-colors"
      >
        <Plus size={18} strokeWidth={2.25} />
      </button>
      {items.slice(2).map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} />
      ))}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
}: {
  item: { href: string; icon: typeof Search; label: string };
  pathname: string | null;
}) {
  const Icon = item.icon;
  const active = pathname === item.href || (pathname ?? "").startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center justify-center w-14 h-full text-[9px] uppercase tracking-[0.1em] font-semibold transition-colors ${
        active ? "text-background" : "text-background/55 hover:text-background"
      }`}
    >
      <Icon size={16} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
      <span className="mt-0.5">{item.label}</span>
    </Link>
  );
}
