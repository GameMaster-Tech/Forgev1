"use client";

/**
 * ProjectActionsMenu — overflow menu for a single project.
 *
 * Surfaces the project-management verbs the workspace was missing:
 * rename, archive / unarchive, export, and delete (soft-delete to
 * Trash). Used on both the Projects index rows and the project header.
 *
 * Self-contained: owns its rename + delete-confirm modals and talks to
 * the projects store directly, calling `onChanged` so the host can
 * refresh any local view. Obsidian-Ink styling — sharp edges, violet
 * accent, semantic tokens.
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MoreHorizontal,
  Pencil,
  Archive,
  ArchiveRestore,
  Download,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore, type Project } from "@/store/projects";
import { ExportDialog } from "@/components/io/ExportDialog";

const ease = [0.22, 0.61, 0.36, 1] as const;

export function ProjectActionsMenu({
  project,
  onChanged,
  align = "right",
}: {
  project: Project;
  /** Called after a mutation so the host can re-sort / refresh. */
  onChanged?: () => void;
  align?: "left" | "right";
}) {
  const updateProject = useProjectsStore((s) => s.updateProject);
  const deleteProject = useProjectsStore((s) => s.deleteProject);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const isArchived = project.status === "archived";

  const handleArchiveToggle = useCallback(async () => {
    setBusy(true);
    try {
      await updateProject(project.id, { status: isArchived ? "active" : "archived" });
      toast.success(isArchived ? "Project unarchived" : "Project archived");
      onChanged?.();
    } catch {
      toast.error("Couldn't update project");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [isArchived, project.id, updateProject, onChanged]);

  const handleDelete = useCallback(async () => {
    setBusy(true);
    try {
      await deleteProject(project.id);
      toast.success("Project moved to Trash", {
        description: "Recover it from Settings → Trash.",
      });
      setConfirming(false);
      onChanged?.();
    } catch {
      toast.error("Couldn't delete project");
    } finally {
      setBusy(false);
    }
  }, [deleteProject, project.id, onChanged]);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label="Project actions"
          aria-expanded={open}
          className="p-1.5 text-muted hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        >
          <MoreHorizontal size={15} strokeWidth={1.75} />
        </button>
        <AnimatePresence>
          {open ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }}
              />
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
                onClick={(e) => e.preventDefault()}
                className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-48 bg-background border border-border shadow-[0_16px_32px_-16px_rgba(0,0,0,0.25)] overflow-hidden z-50`}
              >
                <MenuButton
                  icon={Pencil}
                  label="Rename"
                  onClick={() => {
                    setRenaming(true);
                    setOpen(false);
                  }}
                />
                <MenuButton
                  icon={isArchived ? ArchiveRestore : Archive}
                  label={isArchived ? "Unarchive" : "Archive"}
                  busy={busy}
                  onClick={handleArchiveToggle}
                />
                <MenuButton
                  icon={Download}
                  label="Export"
                  onClick={() => {
                    setExporting(true);
                    setOpen(false);
                  }}
                />
                <MenuButton
                  icon={Trash2}
                  label="Delete"
                  danger
                  onClick={() => {
                    setConfirming(true);
                    setOpen(false);
                  }}
                />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>

      <RenameModal
        open={renaming}
        initialName={project.name}
        onCancel={() => setRenaming(false)}
        onSubmit={async (name) => {
          await updateProject(project.id, { name });
          toast.success("Project renamed");
          setRenaming(false);
          onChanged?.();
        }}
      />

      <ConfirmDeleteModal
        open={confirming}
        name={project.name}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={handleDelete}
      />

      <ExportDialog
        open={exporting}
        onClose={() => setExporting(false)}
        projectId={project.id}
      />
    </>
  );
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  danger,
  busy,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-colors disabled:opacity-50 ${
        danger
          ? "text-rose/80 hover:text-rose hover:bg-rose/[0.05] border-t border-border"
          : "text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04]"
      }`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} strokeWidth={1.75} />}
      <span>{label}</span>
    </button>
  );
}

function RenameModal({
  open,
  initialName,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  // Reset the field whenever the modal re-opens for a (possibly
  // different) project.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setName(initialName);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch {
      toast.error("Couldn't rename project");
    } finally {
      setBusy(false);
    }
  };

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
            aria-label="Rename project"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease }}
            className="fixed left-1/2 top-1/2 z-[61] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-[0_32px_80px_-32px_rgba(0,0,0,0.5)]"
          >
            <div className="px-6 pt-6 pb-5">
              <h2 className="font-display font-bold text-[18px] text-foreground tracking-[-0.02em] mb-4">
                Rename project
              </h2>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") onCancel();
                }}
                className="w-full bg-surface border border-border focus:border-violet outline-none text-[14px] text-foreground px-3 py-2.5 transition-colors"
              />
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
                onClick={submit}
                disabled={busy || !name.trim()}
                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 px-4 py-2 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                Save
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function ConfirmDeleteModal({
  open,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  name: string;
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
            aria-label="Delete project"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease }}
            className="fixed left-1/2 top-1/2 z-[61] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-[0_32px_80px_-32px_rgba(0,0,0,0.5)]"
          >
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 border border-rose/40 bg-rose/[0.06] flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-rose" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-[18px] text-foreground tracking-[-0.02em]">
                    Delete this project?
                  </h2>
                  <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
                    <span className="text-foreground/80 font-medium">{name}</span>{" "}
                    and its documents will move to Trash. You can restore everything
                    from Settings → Trash — nothing is permanently lost.
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
                Move to Trash
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
