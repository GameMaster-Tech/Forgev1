"use client";

/**
 * NotificationBell — header bell with unread badge + drop-down panel.
 *
 * Drop-down uses framer-motion fade-in + AnimatePresence. Click outside
 * to close. Esc to close. Roving tabindex inside the list.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Trash2, Settings, X } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationPanel } from "./NotificationPanel";
import { PreferencesPane } from "./PreferencesPane";

const ease = [0.22, 0.61, 0.36, 1] as const;

export function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"panel" | "prefs">("panel");
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((p) => !p); setView("panel"); }}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        className="relative w-9 h-9 flex items-center justify-center border border-border text-foreground hover:border-violet hover:text-violet transition-colors focus-ring"
      >
        <Bell size={14} strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet text-white text-[9px] font-bold tabular-nums flex items-center justify-center px-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease }}
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] bg-background border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)] z-50"
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView("panel")}
                  className={`text-[10px] uppercase tracking-[0.12em] font-semibold ${view === "panel" ? "text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  Notifications
                </button>
                <button
                  onClick={() => setView("prefs")}
                  className={`text-[10px] uppercase tracking-[0.12em] font-semibold flex items-center gap-1 ${view === "prefs" ? "text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  <Settings size={10} /> Preferences
                </button>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-foreground">
                <X size={12} />
              </button>
            </div>

            {view === "panel" && (
              <>
                <div className="px-4 py-2 border-b border-border flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-semibold">
                  <span className="text-muted tabular-nums">
                    {items.length} {items.length === 1 ? "entry" : "entries"} · {unreadCount} unread
                  </span>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-muted hover:text-foreground inline-flex items-center gap-1">
                        <CheckCheck size={10} /> Mark all read
                      </button>
                    )}
                    {items.length > 0 && (
                      <button onClick={clearAll} className="text-muted hover:text-rose inline-flex items-center gap-1">
                        <Trash2 size={10} /> Clear
                      </button>
                    )}
                  </div>
                </div>
                <NotificationPanel items={items} onMarkRead={markRead} onClose={() => setOpen(false)} />
              </>
            )}

            {view === "prefs" && <PreferencesPane />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
