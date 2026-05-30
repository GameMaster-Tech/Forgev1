"use client";

/**
 * ResumeCard — "Continue where you left off". Kills the returning-user cold
 * start by surfacing the last document worked on (tracked in localStorage by
 * the doc page). Renders nothing until there's something to resume.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { getLastDoc, type LastDoc } from "@/lib/voice/lastVisited";

export function ResumeCard({ className = "" }: { className?: string }) {
  const [last, setLast] = useState<LastDoc | null>(null);

  useEffect(() => {
    setLast(getLastDoc());
  }, []);

  if (!last) return null;

  return (
    <Link
      href={`/project/${last.projectId}/doc/${last.docId}`}
      className={`group flex items-center gap-3 border border-border rounded-[0.625rem] px-4 py-3 bg-foreground/[0.02] hover:bg-violet/[0.05] hover:border-violet/40 transition-colors ${className}`}
    >
      <span className="w-8 h-8 shrink-0 rounded-full bg-violet/10 text-violet flex items-center justify-center">
        <Clock size={14} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[9px] uppercase tracking-[0.18em] text-muted font-semibold">
          Continue where you left off
        </span>
        <span className="block text-[14px] font-medium text-foreground truncate">
          {last.title || "Untitled document"}
        </span>
      </span>
      <ArrowRight
        size={15}
        strokeWidth={2}
        className="ml-auto shrink-0 text-muted group-hover:text-violet group-hover:translate-x-0.5 transition-all"
      />
    </Link>
  );
}
