"use client";

/**
 * ExportDialog — Forge-styled export modal.
 *
 * Layout: max-w-2xl, two-column on sm+ (5/12 controls, 7/12 preview).
 * Preview pane renders the first ~200 lines of the serialised output
 * in monospace on `bg-surface-light`. Format chips, include-options
 * checklist, download CTA.
 *
 * Pure UI — the parent supplies the export trigger (fetch to
 * /api/projects/[pid]/export) and any side effects.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { X, Download, Loader2, FileText, Layers, Calendar, Code, FileJson, Eye, EyeOff } from "lucide-react";
import {
  DEFAULT_INCLUDE,
  type ExportFormat,
  type ExportInclude,
} from "@/lib/io";

const ease = [0.22, 0.61, 0.36, 1] as const;

const FORMATS: { key: ExportFormat; label: string; icon: typeof FileText; description: string }[] = [
  { key: "markdown", label: "Markdown",   icon: FileText, description: "Lossless · YAML front-matter · cites preserved" },
  { key: "notion",   label: "Notion",     icon: Layers,   description: "Blocks payload · pipe to Notion API" },
  { key: "gdoc",     label: "Google Doc", icon: Calendar, description: "Plain body + manifest sidecar · one-way friendly" },
  { key: "json",     label: "JSON",       icon: FileJson, description: "Canonical manifest · lossless · machine-readable" },
];

const INCLUDE_ITEMS: { key: keyof ExportInclude; label: string; tone: string }[] = [
  { key: "syncGraph",   label: "Sync graph (assertions + constraints)", tone: "text-violet" },
  { key: "pulseBlocks", label: "Pulse content blocks",                  tone: "text-cyan"   },
  { key: "documents",   label: "Documents (prose)",                     tone: "text-foreground" },
  { key: "lattice",     label: "Lattice task trees",                    tone: "text-violet" },
  { key: "calendar",    label: "Calendar (events, habits, goals)",      tone: "text-warm"   },
];

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Project id — used in the export API URL. */
  projectId: string;
  /** When true, hits `?demo=1` so unauthenticated previews still work. */
  demo?: boolean;
}

interface PreviewState {
  body: string | null;
  loading: boolean;
  error: string | null;
}

export function ExportDialog({ open, onClose, projectId, demo }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [include, setInclude] = useState<ExportInclude>(DEFAULT_INCLUDE);
  const [preview, setPreview] = useState<PreviewState>({ body: null, loading: false, error: null });
  const [showPreview, setShowPreview] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [, startTransition] = useTransition();

  // Debounced preview fetch — refetches when format/include/projectId change.
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void fetchPreview();
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, include, projectId, demo]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function fetchPreview() {
    setPreview((p) => ({ ...p, loading: true, error: null }));
    try {
      const url = `/api/projects/${encodeURIComponent(projectId)}/export${demo ? "?demo=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, include }),
      });
      if (!res.ok) {
        setPreview({ body: null, loading: false, error: `HTTP ${res.status}` });
        return;
      }
      const text = await res.text();
      startTransition(() => {
        setPreview({ body: clipToLines(text, 200), loading: false, error: null });
      });
    } catch (err) {
      setPreview({ body: null, loading: false, error: (err as Error).message });
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const url = `/api/projects/${encodeURIComponent(projectId)}/export${demo ? "?demo=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, include }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] ?? `forge-export.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setPreview((p) => ({ ...p, error: (err as Error).message }));
    } finally {
      setDownloading(false);
    }
  }

  const includedCount = useMemo(() => Object.values(include).filter(Boolean).length, [include]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/35 z-50 flex items-end sm:items-center sm:justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Export project"
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-background border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={12} className="text-violet" strokeWidth={2} />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">Export project</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground focus-ring" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 sm:grid-cols-12 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Controls (5/12) */}
          <div className="sm:col-span-5 px-5 py-5 space-y-5">
            <fieldset>
              <legend className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-2">Format</legend>
              <ul className="space-y-1.5">
                {FORMATS.map((f) => {
                  const Icon = f.icon;
                  const active = format === f.key;
                  return (
                    <li key={f.key}>
                      <button
                        type="button"
                        onClick={() => setFormat(f.key)}
                        aria-pressed={active}
                        className={`group w-full text-left border px-3 py-2 transition-colors duration-150 ${active ? "border-violet bg-violet/[0.06]" : "border-border hover:border-foreground"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={11} strokeWidth={2} className={active ? "text-violet" : "text-muted"} />
                          <span className={`text-[13px] font-semibold ${active ? "text-foreground" : "text-foreground"}`}>{f.label}</span>
                        </div>
                        <p className="text-[11px] text-muted leading-relaxed mt-0.5">{f.description}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <fieldset>
              <legend className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-2">
                Include · {includedCount}/{INCLUDE_ITEMS.length}
              </legend>
              <ul className="space-y-1">
                {INCLUDE_ITEMS.map((item) => (
                  <li key={item.key}>
                    <label className="flex items-start gap-2.5 px-2 py-1.5 cursor-pointer hover:bg-violet/[0.04] transition-colors">
                      <input
                        type="checkbox"
                        checked={include[item.key]}
                        onChange={(e) => setInclude((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                        className="mt-0.5 accent-violet w-3.5 h-3.5"
                      />
                      <span className="text-[12px] text-foreground leading-relaxed">{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>

          {/* Preview (7/12) */}
          <div className="sm:col-span-7 px-5 py-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold inline-flex items-center gap-1.5">
                <Code size={10} /> Preview
              </span>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground inline-flex items-center gap-1 sm:hidden"
              >
                {showPreview ? <><EyeOff size={10} /> Hide</> : <><Eye size={10} /> Show</>}
              </button>
            </div>
            {showPreview && (
              <div className="border border-border bg-surface-light max-h-[420px] overflow-auto">
                {preview.loading && !preview.body ? (
                  <div className="px-4 py-8 text-center text-muted text-[12px] inline-flex items-center justify-center gap-2 w-full">
                    <Loader2 size={11} className="animate-spin" /> Building preview…
                  </div>
                ) : preview.error ? (
                  <div className="px-4 py-4 text-rose text-[12px]">Preview failed: {preview.error}</div>
                ) : (
                  <pre className="text-[11.5px] leading-relaxed text-foreground/85 px-4 py-3 whitespace-pre-wrap break-words font-mono">
{preview.body ?? "(empty)"}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
            {includedCount === 0 ? "Pick at least one collection." : `${format} · ${includedCount} collections`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2">Cancel</button>
            <button
              onClick={handleDownload}
              disabled={downloading || includedCount === 0}
              className="bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors btn-glow-violet inline-flex items-center gap-2"
            >
              {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              Download
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function clipToLines(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= n) return text;
  return lines.slice(0, n).join("\n") + `\n\n… (${lines.length - n} more lines)`;
}
