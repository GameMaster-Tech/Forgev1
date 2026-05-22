"use client";

/**
 * SectionSubNav — sticky editorial nav that ties multiple route
 * pages within a section (e.g. /pulse, /pulse/diffs, /pulse/refactors)
 * into one visual surface.
 *
 * Uses Next's `<Link>` + `usePathname` for active highlighting and
 * Framer Motion's `layoutId` for the smooth violet underline that
 * slides between tabs — same pattern the in-page tab arrays used
 * before, just route-aware now.
 *
 * Headless w.r.t. content: callers pass the tab list + a
 * `layoutId` namespace so multiple SectionSubNavs can coexist.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

export interface SubNavItem {
  /** Route href. Trailing slash agnostic. */
  href: string;
  label: string;
  /** Optional badge (count, status). */
  badge?: string | number | null;
  /** Optional lucide icon component. */
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

export interface SectionSubNavProps {
  items: SubNavItem[];
  /** Namespaces the framer-motion layoutId so multiple sub-navs don't collide. */
  layoutId: string;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export function SectionSubNav({ items, layoutId, className }: SectionSubNavProps) {
  const pathname = usePathname() ?? "";
  return (
    <div className={`border-y border-border bg-background sticky top-0 z-10 ${className ?? ""}`}>
      <div className="px-4 sm:px-10 flex items-center overflow-x-auto no-scrollbar">
        {items.map((t) => {
          const active = isActive(pathname, t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              prefetch
              className={`relative text-[11px] uppercase tracking-[0.14em] font-semibold px-4 py-3 transition-colors duration-150 inline-flex items-center gap-2 whitespace-nowrap focus-ring ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
              aria-current={active ? "page" : undefined}
            >
              {Icon && <Icon size={11} strokeWidth={1.75} />}
              {t.label}
              {t.badge != null && t.badge !== "" && (
                <span className={`text-[10px] tabular-nums px-1.5 py-0.5 ${active ? "bg-violet text-white" : "bg-surface-light text-muted"}`}>
                  {t.badge}
                </span>
              )}
              {active && (
                <motion.span
                  layoutId={layoutId}
                  transition={{ duration: 0.22, ease }}
                  className="absolute left-0 right-0 -bottom-px h-[2px] bg-violet"
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Section root `/pulse` matches itself only; children `/pulse/diffs` match prefix. */
function isActive(pathname: string, href: string): boolean {
  const p = stripTrail(pathname);
  const h = stripTrail(href);
  if (p === h) return true;
  // Don't let the root href win for descendant paths.
  if (h === "/") return p === "/";
  // Section root: only match exactly, not as a prefix.
  const isSectionRoot = /^\/[^/]+$/.test(h);
  if (isSectionRoot) return p === h;
  return p.startsWith(h + "/");
}

function stripTrail(s: string): string {
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}
