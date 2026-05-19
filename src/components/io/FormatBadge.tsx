"use client";

/**
 * FormatBadge — surfaces the source format on imported docs.
 * Uses the existing eyebrow pattern (no rounded corners, uppercase).
 */

import type { ExportFormat } from "@/lib/io";

const META: Record<ExportFormat, { label: string; tone: string; bg: string }> = {
  markdown: { label: "Markdown", tone: "text-violet", bg: "bg-violet" },
  notion:   { label: "Notion",   tone: "text-rose",   bg: "bg-rose"   },
  gdoc:     { label: "Google Doc", tone: "text-cyan", bg: "bg-cyan"   },
  json:     { label: "JSON",     tone: "text-warm",   bg: "bg-warm"   },
};

export function FormatBadge({ format, label }: { format: ExportFormat; label?: string }) {
  const m = META[format];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold ${m.tone}`}>
      <span className={`w-1.5 h-1.5 ${m.bg}`} />
      {label ?? m.label}
    </span>
  );
}
