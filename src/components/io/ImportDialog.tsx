"use client";

/**
 * ImportDialog — file drop + paste + URL fetcher. Two-step flow:
 * preview → commit.
 *
 * Matches ExportDialog geometry (max-w-2xl, two-column on sm+).
 * Left: source picker (file/paste/url) + format detection.
 * Right: mapping preview with per-collection counts + validation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  X, Upload, FileText, Loader2, ClipboardPaste, Link2, AlertTriangle, CheckCircle2,
  FileJson, Layers, Calendar,
} from "lucide-react";
import { type ExportFormat, type ImportPreview, type ImportSource } from "@/lib/io";

const ease = [0.22, 0.61, 0.36, 1] as const;

const FORMATS: { key: ExportFormat; label: string; icon: typeof FileText }[] = [
  { key: "markdown", label: "Markdown",   icon: FileText },
  { key: "notion",   label: "Notion",     icon: Layers   },
  { key: "gdoc",     label: "Google Doc", icon: Calendar },
  { key: "json",     label: "JSON",       icon: FileJson },
];

const SOURCES: { key: ImportSource; label: string; icon: typeof Upload; description: string }[] = [
  { key: "file",  label: "Upload file", icon: Upload,         description: "Drop a .md / .json file" },
  { key: "paste", label: "Paste text",  icon: ClipboardPaste, description: "Paste the raw export body" },
  { key: "url",   label: "Fetch URL",   icon: Link2,          description: "Pull from a public URL" },
];

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Called with the parsed manifest counts after a successful commit. */
  onCommitted?: (counts: ImportPreview["counts"]) => void;
}

interface ImportState {
  format: ExportFormat;
  source: ImportSource;
  raw: string;
  url: string;
  fileMeta?: { name: string; sizeBytes: number };
  preview: ImportPreview | null;
  previewing: boolean;
  committing: boolean;
  error: string | null;
}

const INITIAL: ImportState = {
  format: "markdown",
  source: "file",
  raw: "",
  url: "",
  preview: null,
  previewing: false,
  committing: false,
  error: null,
};

export function ImportDialog({ open, onClose, projectId, onCommitted }: ImportDialogProps) {
  const [state, setState] = useState<ImportState>(INITIAL);
  const dropRef = useRef<HTMLDivElement | null>(null);

  // Reset on each open.
  useEffect(() => {
    if (open) setState(INITIAL);
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced preview when raw or format changes.
  useEffect(() => {
    if (!open || !state.raw) {
      if (state.preview) setState((s) => ({ ...s, preview: null }));
      return;
    }
    const handle = setTimeout(() => void fetchPreview(state.raw, state.format), 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.raw, state.format]);

  async function fetchPreview(raw: string, format: ExportFormat) {
    setState((s) => ({ ...s, previewing: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/import?mode=preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, raw, fileMeta: state.fileMeta }),
      });
      const data = await res.json() as ImportPreview;
      setState((s) => ({ ...s, preview: data, previewing: false }));
    } catch (err) {
      setState((s) => ({ ...s, previewing: false, error: (err as Error).message }));
    }
  }

  async function fetchFromUrl() {
    if (!state.url) return;
    setState((s) => ({ ...s, previewing: true, error: null }));
    try {
      const res = await fetch(state.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      setState((s) => ({ ...s, raw, previewing: false }));
    } catch (err) {
      setState((s) => ({ ...s, previewing: false, error: (err as Error).message }));
    }
  }

  async function handleCommit() {
    if (!state.preview || state.preview.errors.length > 0) return;
    setState((s) => ({ ...s, committing: true }));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/import?mode=commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: state.format, raw: state.raw, fileMeta: state.fileMeta }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; counts?: ImportPreview["counts"] };
      if (!data.ok) throw new Error(data.error ?? "commit failed");
      onCommitted?.(state.preview.counts);
      onClose();
    } catch (err) {
      setState((s) => ({ ...s, committing: false, error: (err as Error).message }));
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      // Infer format from extension when possible.
      const format = inferFormat(file.name) ?? state.format;
      setState((s) => ({ ...s, raw, format, fileMeta: { name: file.name, sizeBytes: file.size } }));
    };
    reader.readAsText(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const counts = state.preview?.counts;
  const totalRows = useMemo(() => {
    if (!counts) return 0;
    return counts.assertions + counts.documents + counts.constraints + counts.habits + counts.goals + counts.blocks;
  }, [counts]);

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
      aria-label="Import project"
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-background border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload size={12} className="text-violet" strokeWidth={2} />
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">Import project</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground focus-ring" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Source picker */}
          <div className="sm:col-span-5 px-5 py-5 space-y-5">
            <fieldset>
              <legend className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-2">Source</legend>
              <ul className="space-y-1.5">
                {SOURCES.map((src) => {
                  const Icon = src.icon;
                  const active = state.source === src.key;
                  return (
                    <li key={src.key}>
                      <button
                        type="button"
                        onClick={() => setState((s) => ({ ...s, source: src.key }))}
                        aria-pressed={active}
                        className={`w-full text-left border px-3 py-2 transition-colors duration-150 ${active ? "border-violet bg-violet/[0.06]" : "border-border hover:border-foreground"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={11} strokeWidth={2} className={active ? "text-violet" : "text-muted"} />
                          <span className="text-[13px] font-semibold text-foreground">{src.label}</span>
                        </div>
                        <p className="text-[11px] text-muted mt-0.5">{src.description}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <fieldset>
              <legend className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-2">Format</legend>
              <div className="flex flex-wrap gap-1.5">
                {FORMATS.map((f) => {
                  const Icon = f.icon;
                  const active = state.format === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setState((s) => ({ ...s, format: f.key }))}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1.5 border transition-colors ${active ? "border-violet bg-violet text-white" : "border-border text-muted hover:border-foreground hover:text-foreground"}`}
                    >
                      <Icon size={10} /> {f.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {state.source === "file" && (
              <div
                ref={dropRef}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={onDrop}
                className="border-2 border-dashed border-border bg-surface-light px-4 py-6 text-center cursor-pointer hover:border-violet transition-colors"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".md,.markdown,.json,.txt";
                  input.onchange = () => { const f = input.files?.[0]; if (f) handleFile(f); };
                  input.click();
                }}
              >
                <FileText size={14} className="mx-auto text-muted mb-1" />
                <p className="text-[12px] text-foreground font-medium">Drop a file here</p>
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted mt-1">or click to browse</p>
                {state.fileMeta && (
                  <p className="text-[11px] text-violet mt-2 font-medium">
                    {state.fileMeta.name} · {(state.fileMeta.sizeBytes / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            )}

            {state.source === "paste" && (
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-1.5 block">Raw text</span>
                <textarea
                  value={state.raw}
                  onChange={(e) => setState((s) => ({ ...s, raw: e.target.value }))}
                  placeholder={"Paste the exported body here…"}
                  rows={8}
                  className="w-full border border-border bg-background px-3 py-2 text-[12px] font-mono focus:border-violet outline-none resize-y"
                />
              </label>
            )}

            {state.source === "url" && (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-1.5 block">URL</span>
                  <input
                    type="url"
                    value={state.url}
                    onChange={(e) => setState((s) => ({ ...s, url: e.target.value }))}
                    placeholder="https://…"
                    className="w-full border border-border bg-background px-3 py-2 text-[12px] focus:border-violet outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={fetchFromUrl}
                  disabled={!state.url || state.previewing}
                  className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet border border-violet/40 hover:bg-violet hover:text-white transition-colors px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {state.previewing ? <Loader2 size={10} className="animate-spin" /> : <Link2 size={10} />} Fetch
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="sm:col-span-7 px-5 py-5">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-3">Mapping preview</div>
            {!state.preview && !state.raw && (
              <div className="border border-border bg-surface-light py-12 px-4 text-center text-muted text-[12px]">
                Pick a source to see what will be imported.
              </div>
            )}
            {state.previewing && (
              <div className="text-[12px] text-muted inline-flex items-center gap-2"><Loader2 size={11} className="animate-spin" /> Parsing…</div>
            )}
            {state.preview && counts && (
              <>
                <div className="border border-border divide-y divide-border bg-surface">
                  <CountRow label="Assertions"  value={counts.assertions}  tone="text-violet" />
                  <CountRow label="Documents"   value={counts.documents}   tone="text-cyan"   />
                  <CountRow label="Blocks"      value={counts.blocks}      tone="text-cyan"   />
                  <CountRow label="Constraints" value={counts.constraints} tone="text-warm"   />
                  <CountRow label="Habits"      value={counts.habits}      tone="text-green"  />
                  <CountRow label="Goals"       value={counts.goals}       tone="text-rose"   />
                  <CountRow label="Total"       value={totalRows}          tone="text-foreground" emphasize />
                </div>
                {state.preview.errors.length > 0 && (
                  <div className="mt-3 border-l-2 border-rose bg-rose/[0.05] px-3 py-2 space-y-1">
                    {state.preview.errors.map((err, i) => (
                      <p key={i} className="text-[11.5px] text-rose flex items-start gap-1.5">
                        <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {err}
                      </p>
                    ))}
                  </div>
                )}
                {state.preview.warnings.length > 0 && (
                  <div className="mt-3 border-l-2 border-warm bg-warm/[0.05] px-3 py-2 space-y-1">
                    {state.preview.warnings.map((warn, i) => (
                      <p key={i} className="text-[11.5px] text-warm flex items-start gap-1.5">
                        <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {warn}
                      </p>
                    ))}
                  </div>
                )}
                {state.preview.errors.length === 0 && state.preview.warnings.length === 0 && (
                  <div className="mt-3 text-[11.5px] text-green inline-flex items-center gap-1.5">
                    <CheckCircle2 size={10} /> No issues. Safe to commit.
                  </div>
                )}
              </>
            )}
            {state.error && (
              <p className="text-[11.5px] text-rose mt-3">{state.error}</p>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
            {state.preview ? `${totalRows} rows ready` : "Drop or paste to begin"}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2">Cancel</button>
            <button
              onClick={handleCommit}
              disabled={state.committing || !state.preview || state.preview.errors.length > 0 || totalRows === 0}
              className="bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors btn-glow-violet inline-flex items-center gap-2"
            >
              {state.committing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Commit import
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CountRow({ label, value, tone, emphasize }: { label: string; value: number; tone: string; emphasize?: boolean }) {
  return (
    <div className={`px-4 py-2 flex items-center justify-between ${emphasize ? "bg-surface-light" : ""}`}>
      <span className={`text-[11px] uppercase tracking-[0.12em] font-${emphasize ? "bold" : "semibold"} ${tone}`}>{label}</span>
      <span className={`text-[13px] tabular-nums ${emphasize ? "text-foreground font-display font-bold" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function inferFormat(filename: string): ExportFormat | null {
  if (/\.md$|\.markdown$/i.test(filename)) return "markdown";
  if (/\.notion\.json$/i.test(filename))   return "notion";
  if (/\.gdoc\.json$/i.test(filename))     return "gdoc";
  if (/\.json$/i.test(filename))           return "json";
  return null;
}
