"use client";

/**
 * Sidebar — Notion-style expandable rail.
 *
 * Two states, persisted to localStorage so the user's preference
 * survives reloads:
 *
 *   Collapsed (56px)
 *     • Brand mark, quick-create +, icon-only nav, footer (theme /
 *       tour / sign-out / avatar). Hover tooltips on every icon.
 *
 *   Expanded (260px)
 *     • Brand mark + Forge wordmark + collapse chevron
 *     • Cmd-K search row
 *     • Quick-create button (full label)
 *     • RECENT CHATS — top section. Live `useRecentChats` subscription;
 *       new turns re-order the list in real time. Click jumps into
 *       /research with the conversation pre-loaded.
 *     • Workspace nav with labels
 *     • Footer (theme + tour + sign-out, avatar with name + email)
 *
 * Width animates with framer-motion so the toggle feels physical.
 * Hover-to-peek is intentionally disabled — explicit expand only,
 * since the recent-chats area would flicker open on every cursor
 * brush through the sidebar zone otherwise.
 */

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Calendar,
  CalendarPlus,
  ChevronsLeft,
  ChevronsRight,
  Command,
  Compass,
  FileText,
  FolderOpen,
  FolderPlus,
  GitBranch,
  History,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { replayTutorial } from "@/components/onboarding/Tutorial";
import { useRecentChats } from "@/hooks/useRecentChats";
import { EchoBell } from "@/components/echo/EchoBell";
import { AccountSwitcher } from "@/components/app/AccountSwitcher";

const ease = [0.22, 0.61, 0.36, 1] as const;
const COLLAPSED_W = 56;
const EXPANDED_W = 260;
const STORAGE_KEY = "forge.sidebar.expanded.v1";

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

function RailTooltip({ label, hide }: { label: string; hide?: boolean }) {
  if (hide) return null;
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
  expanded: boolean;
}

function QuickCreateMenu({ open, onClose, onNewProject, expanded }: QuickCreateMenuProps) {
  const router = useRouter();

  const items = [
    {
      icon: FileText,
      label: "Document",
      hint: "Open a project and start writing",
      onClick: () => {
        router.push("/projects");
        onClose();
      },
    },
    {
      icon: MessageSquare,
      label: "Chat",
      hint: "Start a new research conversation",
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
            className={`absolute z-50 w-60 bg-foreground text-background border border-white/10 shadow-[0_24px_56px_-20px_rgba(0,0,0,0.55)] overflow-hidden ${
              expanded
                ? "left-2 right-2 top-full mt-1"
                : "left-full ml-3 top-0"
            }`}
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
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Hydrate expanded state from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setExpanded(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Close quick-create on route change.
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

  const recentChats = useRecentChats(user?.uid ?? null, 8);

  const openChat = useCallback(
    (chatId: string) => {
      // /research surface reads `?c=` to resume an existing thread.
      router.push(`/research?c=${encodeURIComponent(chatId)}`);
    },
    [router],
  );

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? EXPANDED_W : COLLAPSED_W }}
      transition={{ duration: 0.24, ease }}
      className="shrink-0 flex flex-col h-full bg-foreground text-background relative border-r border-white/[0.07] overflow-hidden"
      style={{ width: expanded ? EXPANDED_W : COLLAPSED_W }}
    >
      {/* ── Brand row ─────────────────────────────── */}
      <div
        className={`relative h-14 flex items-center shrink-0 border-b border-white/[0.07] ${
          expanded ? "px-3" : "justify-center"
        }`}
      >
        <Link
          href="/research"
          aria-label="Forge"
          className="group relative w-8 h-8 bg-violet flex items-center justify-center hover:bg-violet/90 transition-colors duration-200 shrink-0"
        >
          <span className="font-display font-black text-white text-[13px] leading-none">
            F
          </span>
        </Link>
        <AnimatePresence>
          {expanded ? (
            <motion.span
              key="wordmark"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15, ease }}
              className="ml-2.5 font-display font-bold text-background text-[15px] tracking-[-0.018em]"
            >
              Forge
            </motion.span>
          ) : null}
        </AnimatePresence>
        {expanded ? (
          <button
            type="button"
            onClick={toggleExpanded}
            aria-label="Collapse sidebar"
            className="ml-auto p-1.5 text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors"
          >
            <ChevronsLeft size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* When collapsed, give a chevron to expand right under the brand. */}
      {!expanded ? (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label="Expand sidebar"
          className="group relative h-7 flex items-center justify-center text-background/45 hover:text-background hover:bg-white/[0.05] transition-colors duration-150 border-b border-white/[0.05]"
        >
          <ChevronsRight size={12} strokeWidth={2} />
          <RailTooltip label="Expand sidebar" />
        </button>
      ) : null}

      {/* ── Search row (expanded only) ─────────────────── */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease }}
            className="px-3 pt-3 pb-2 shrink-0"
          >
            <button
              type="button"
              onClick={() => {
                // Fire the Cmd-K palette. We dispatch a keyboard event the
                // palette is listening for so we don't need to import its
                // imperative API.
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "k",
                    metaKey: true,
                    ctrlKey: true,
                    bubbles: true,
                  }),
                );
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left"
            >
              <Search size={12} strokeWidth={2} className="text-background/55 shrink-0" />
              <span className="text-[11.5px] text-background/55 flex-1 truncate">
                Search Forge
              </span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-background/35 font-medium inline-flex items-center gap-1">
                <Command size={10} strokeWidth={2} />K
              </span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── Quick-create ─────────────────── */}
      <div className={`relative shrink-0 ${expanded ? "px-3 pt-1 pb-2" : "px-2 pt-3 pb-2"}`}>
        <button
          type="button"
          onClick={() => setCreateOpen((v) => !v)}
          aria-label="Create"
          aria-expanded={createOpen}
          className={`group relative w-full h-9 flex items-center transition-colors duration-150 ${
            createOpen ? "bg-violet/90" : "bg-violet hover:bg-violet/90"
          } text-white ${expanded ? "px-3 justify-start gap-2" : "justify-center"}`}
        >
          <Plus
            size={14}
            strokeWidth={2.25}
            className={`transition-transform duration-200 ${createOpen ? "rotate-45" : ""}`}
          />
          {expanded ? (
            <span className="text-[11.5px] uppercase tracking-[0.14em] font-bold">
              {createOpen ? "Close" : "Create"}
            </span>
          ) : null}
          {!createOpen && !expanded ? <RailTooltip label="Create" /> : null}
        </button>
        <QuickCreateMenu
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onNewProject={onNewProject}
          expanded={expanded}
        />
      </div>

      {/* ── Recent chats (expanded only) ─────────────────── */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="recent"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease }}
            className="px-3 pt-2 pb-1 shrink-0"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] uppercase tracking-[0.18em] font-semibold text-background/45">
                Recent chats
              </span>
              <Link
                href="/research"
                className="text-[9px] uppercase tracking-[0.14em] text-background/45 hover:text-background transition-colors"
              >
                All
              </Link>
            </div>
            {recentChats.length === 0 ? (
              <div className="text-[11px] text-background/40 py-1 leading-relaxed">
                Start a chat and it will land here.
              </div>
            ) : (
              <ul className="space-y-0.5 max-h-[180px] overflow-y-auto -mx-1 px-1">
                {recentChats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openChat(c.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.06] transition-colors group"
                    >
                      <MessageSquare
                        size={11}
                        strokeWidth={2}
                        className="text-background/45 group-hover:text-violet shrink-0"
                      />
                      <span className="text-[12px] text-background/80 group-hover:text-background truncate">
                        {c.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── Workspace nav ─────────────────── */}
      <nav
        aria-label="Workspace navigation"
        className={`relative flex-1 ${expanded ? "px-3 pt-3 pb-2 space-y-0.5 overflow-y-auto" : "px-2 pt-1 space-y-0.5"}`}
      >
        {expanded ? (
          <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-background/45 px-2 mb-1.5">
            Workspace
          </div>
        ) : null}
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center transition-colors duration-150 ${
                expanded ? "px-2 py-1.5 gap-2.5" : "justify-center w-full h-9"
              } ${
                active
                  ? "text-background bg-white/[0.08]"
                  : "text-background/55 hover:text-background hover:bg-white/[0.05]"
              }`}
            >
              {active && !expanded && (
                <motion.div
                  layoutId="sidebar-rail-indicator"
                  transition={{ duration: 0.22, ease }}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-violet"
                />
              )}
              {active && expanded && (
                <motion.div
                  layoutId="sidebar-rail-indicator-expanded"
                  transition={{ duration: 0.22, ease }}
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-violet"
                />
              )}
              <Icon
                size={expanded ? 13 : 15}
                strokeWidth={active ? 2.25 : 1.75}
                className="shrink-0"
              />
              {expanded ? (
                <span className="text-[12px] font-medium truncate">
                  {item.label}
                </span>
              ) : (
                <RailTooltip label={item.label} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer cluster ─────────────────── */}
      <div
        className={`relative shrink-0 border-t border-white/[0.07] ${
          expanded ? "px-3 pt-2 pb-3" : "px-2 pt-2 pb-3"
        }`}
      >
        <div className={`${expanded ? "flex items-center gap-1" : "space-y-0.5"}`}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`group relative flex items-center justify-center text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors duration-150 ${
              expanded ? "w-8 h-8" : "w-full h-9"
            }`}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {!expanded ? <RailTooltip label={theme === "dark" ? "Light mode" : "Dark mode"} /> : null}
          </button>

          <button
            type="button"
            onClick={() => replayTutorial()}
            aria-label="Replay tutorial"
            className={`group relative flex items-center justify-center text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors duration-150 ${
              expanded ? "w-8 h-8" : "w-full h-9"
            }`}
          >
            <Compass size={14} />
            {!expanded ? <RailTooltip label="Tour Forge" /> : null}
          </button>

          {/* Echo — opens the tension tray. Pulses when there's an
              unseen high-severity notice. */}
          <EchoBell
            variant="rail"
            className={expanded ? "w-8 h-8" : "w-full h-9"}
          />

          <button
            onClick={() => logout()}
            aria-label="Sign out"
            className={`group relative flex items-center justify-center text-background/55 hover:text-background hover:bg-white/[0.05] transition-colors duration-150 ${
              expanded ? "w-8 h-8" : "w-full h-9"
            }`}
          >
            <LogOut size={14} />
            {!expanded ? <RailTooltip label="Sign out" /> : null}
          </button>
        </div>

        <div className={`${expanded ? "mt-2 pt-2 border-t border-white/[0.07]" : "h-px bg-white/[0.08] mx-1.5 my-1.5"}`} />

        {/* Multi-account switcher — replaces the old Link-to-settings
            avatar. Tap the avatar → dropdown shows current + every
            other Google account that's signed in on this device. */}
        <AccountSwitcher expanded={expanded} />
      </div>
    </motion.aside>
  );
}
