"use client";

/**
 * Trash — the recovery surface.
 *
 * Soft-deleted documents and projects land here instead of vanishing.
 * From here the user can restore (back to its project / workspace) or
 * permanently delete. Permanent deletion is the *only* path in the whole
 * app that destroys data, and it's gated behind an explicit confirm —
 * the primary UI never loses anything.
 *
 * Design: Obsidian Ink — sharp edges, violet accent, semantic tokens,
 * the standard motion.header (eyebrow + h1 + subtitle) and an 8/4 body.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Trash2,
  RotateCcw,
  Loader2,
  FileText,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  getTrashedDocuments,
  getTrashedProjects,
  getUserProjects,
  restoreDocument,
  restoreProject,
  permanentlyDeleteDocument,
  permanentlyDeleteProject,
  type FirestoreDocument,
  type FirestoreProject,
} from "@/lib/firebase/firestore";
import { toast } from "sonner";

const ease = [0.22, 0.61, 0.36, 1] as const;

function tsToMillis(t: { toMillis?: () => number } | null | undefined): number {
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

function whenDeleted(t: { toMillis?: () => number } | null | undefined): string {
  const ms = tsToMillis(t);
  if (!ms) return "recently";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TrashPage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<FirestoreDocument[]>([]);
  const [projects, setProjects] = useState<FirestoreProject[]>([]);
  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "document"; id: string; projectId: string; label: string }
    | { kind: "project"; id: string; label: string }
    | null
  >(null);

  const uid = user?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const [tDocs, tProjects, liveProjects] = await Promise.all([
        getTrashedDocuments(uid),
        getTrashedProjects(uid),
        getUserProjects(uid),
      ]);
      setDocs(tDocs);
      setProjects(tProjects);
      const names = new Map<string, string>();
      for (const p of [...liveProjects, ...tProjects]) names.set(p.id, p.name);
      setProjectNames(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load Trash.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedDocs = useMemo(
    () => [...docs].sort((a, b) => tsToMillis(b.deletedAt) - tsToMillis(a.deletedAt)),
    [docs],
  );
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => tsToMillis(b.deletedAt) - tsToMillis(a.deletedAt)),
    [projects],
  );

  const handleRestoreDoc = useCallback(
    async (d: FirestoreDocument) => {
      setBusyId(d.id);
      try {
        await restoreDocument(d.id, d.projectId);
        setDocs((prev) => prev.filter((x) => x.id !== d.id));
        toast.success("Document restored");
      } catch {
        toast.error("Couldn't restore document");
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const handleRestoreProject = useCallback(async (p: FirestoreProject) => {
    setBusyId(p.id);
    try {
      await restoreProject(p.id);
      setProjects((prev) => prev.filter((x) => x.id !== p.id));
      toast.success("Project restored");
    } catch {
      toast.error("Couldn't restore project");
    } finally {
      setBusyId(null);
    }
  }, []);

  const handlePermanentDelete = useCallback(async () => {
    if (!confirm) return;
    setBusyId(confirm.id);
    try {
      if (confirm.kind === "document") {
        await permanentlyDeleteDocument(confirm.id, confirm.projectId);
        setDocs((prev) => prev.filter((x) => x.id !== confirm.id));
      } else {
        await permanentlyDeleteProject(confirm.id);
        setProjects((prev) => prev.filter((x) => x.id !== confirm.id));
      }
      toast.success("Permanently deleted");
      setConfirm(null);
    } catch {
      toast.error("Couldn't delete");
    } finally {
      setBusyId(null);
    }
  }, [confirm]);

  const isEmpty = !loading && sortedDocs.length === 0 && sortedProjects.length === 0;

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-medium text-muted hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Settings
        </Link>
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
          <Trash2 size={11} strokeWidth={1.75} className="text-muted" />
          Recovery
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          Trash
        </h1>
        <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
          Deleted documents and projects rest here. Restore them whole, or
          permanently delete to free them for good — that last step is the
          only one that actually destroys anything.
        </p>
      </motion.header>

      <div className="px-6 sm:px-10 pt-8 pb-16 max-w-3xl">
        {loading ? (
          <div className="flex items-center gap-3 py-16 justify-center text-[13px] text-muted border border-border bg-surface">
            <Loader2 size={14} className="animate-spin text-violet" />
            Loading Trash…
          </div>
        ) : error ? (
          <div className="border border-rose/40 bg-rose/[0.06] text-rose text-[12px] px-4 py-3">
            {error}
          </div>
        ) : isEmpty ? (
          <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
            <div className="w-12 h-12 border border-border bg-surface mx-auto mb-4 flex items-center justify-center">
              <Trash2 size={16} className="text-muted" />
            </div>
            <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
              Trash is empty.
            </h3>
            <p className="text-[12.5px] text-muted leading-relaxed max-w-sm mx-auto">
              Nothing deleted. When you delete a document or project it will
              wait here so you can change your mind.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedProjects.length > 0 ? (
              <section>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
                  Projects · {sortedProjects.length}
                </p>
                <ul className="divide-y divide-border border border-border bg-surface">
                  {sortedProjects.map((p) => (
                    <TrashRow
                      key={p.id}
                      icon={FolderOpen}
                      title={p.name || "Untitled project"}
                      meta={`Deleted ${whenDeleted(p.deletedAt)} · ${p.docCount} doc${p.docCount === 1 ? "" : "s"}`}
                      busy={busyId === p.id}
                      onRestore={() => handleRestoreProject(p)}
                      onDelete={() =>
                        setConfirm({ kind: "project", id: p.id, label: p.name || "Untitled project" })
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {sortedDocs.length > 0 ? (
              <section>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
                  Documents · {sortedDocs.length}
                </p>
                <ul className="divide-y divide-border border border-border bg-surface">
                  {sortedDocs.map((d) => (
                    <TrashRow
                      key={d.id}
                      icon={FileText}
                      title={d.title || "Untitled document"}
                      meta={`Deleted ${whenDeleted(d.deletedAt)} · ${projectNames.get(d.projectId) ?? "Project"}`}
                      busy={busyId === d.id}
                      onRestore={() => handleRestoreDoc(d)}
                      onDelete={() =>
                        setConfirm({
                          kind: "document",
                          id: d.id,
                          projectId: d.projectId,
                          label: d.title || "Untitled document",
                        })
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>

      <PermanentDeleteModal
        open={confirm !== null}
        label={confirm?.label ?? ""}
        kind={confirm?.kind ?? "document"}
        busy={busyId === confirm?.id}
        onCancel={() => setConfirm(null)}
        onConfirm={handlePermanentDelete}
      />
    </div>
  );
}

function TrashRow({
  icon: Icon,
  title,
  meta,
  busy,
  onRestore,
  onDelete,
}: {
  icon: typeof FileText;
  title: string;
  meta: string;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex items-center gap-4 px-5 py-3.5 hover:bg-violet/[0.04] transition-colors">
      <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0">
        <Icon size={13} strokeWidth={1.75} className="text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-[14.5px] text-foreground truncate tracking-[-0.01em]">
          {title}
        </div>
        <div className="text-[11px] text-muted mt-0.5">{meta}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          className="inline-flex items-center gap-1.5 border border-violet/40 text-violet hover:bg-violet/[0.08] text-[10px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1.5 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          Restore
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete permanently"
          title="Delete permanently"
          className="p-1.5 text-muted hover:text-rose hover:bg-rose/[0.05] transition-colors disabled:opacity-50"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function PermanentDeleteModal({
  open,
  label,
  kind,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  label: string;
  kind: "document" | "project";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[60] bg-foreground/30 backdrop-blur-sm"
            onClick={busy ? undefined : onCancel}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Permanently delete"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease }}
            className="fixed left-1/2 top-1/2 z-[61] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-[0_32px_80px_-32px_rgba(0,0,0,0.5)]"
          >
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 border border-rose/40 bg-rose/[0.06] flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-rose" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-[18px] text-foreground tracking-[-0.02em]">
                    Delete permanently?
                  </h2>
                  <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
                    <span className="text-foreground/80 font-medium">{label}</span>{" "}
                    will be destroyed for good
                    {kind === "project" ? ", along with every document inside it" : ""}.
                    This cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-surface/50">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-4 py-2 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-rose hover:bg-rose/90 px-4 py-2 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete forever
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
