"use client";

/**
 * DocActionsMenu — per-document overflow actions in the project tree.
 *
 * Duplicate, move to another project, and delete (soft-delete to Trash).
 * Move surfaces a submenu of the user's other projects. All actions hit
 * the Firestore helpers and then call `onChanged` so the host re-pulls
 * its document list.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MoreHorizontal,
  Copy,
  FolderInput,
  Trash2,
  Loader2,
  ChevronRight,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore } from "@/store/projects";
import {
  duplicateDocument,
  moveDocument,
  trashDocument,
} from "@/lib/firebase/firestore";

export function DocActionsMenu({
  docId,
  projectId,
  onChanged,
}: {
  docId: string;
  projectId: string;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const projects = useProjectsStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setMoveOpen(false);
  }, []);

  const handleDuplicate = useCallback(async () => {
    setBusy(true);
    try {
      const newId = await duplicateDocument(docId);
      toast.success("Document duplicated");
      close();
      router.push(`/project/${projectId}/doc/${newId}`);
    } catch {
      toast.error("Couldn't duplicate");
      setBusy(false);
    }
  }, [docId, projectId, router, close]);

  const handleMove = useCallback(
    async (toProjectId: string) => {
      setBusy(true);
      try {
        await moveDocument(docId, projectId, toProjectId);
        toast.success("Document moved");
        close();
        onChanged?.();
      } catch {
        toast.error("Couldn't move");
      } finally {
        setBusy(false);
      }
    },
    [docId, projectId, close, onChanged],
  );

  const handleDelete = useCallback(async () => {
    setBusy(true);
    try {
      await trashDocument(docId, projectId);
      toast.success("Moved to Trash", {
        description: "Recover it from Settings → Trash.",
        action: {
          label: "Undo",
          onClick: () => {
            import("@/lib/firebase/firestore").then(({ restoreDocument }) =>
              restoreDocument(docId, projectId)
                .then(() => {
                  toast.success("Restored");
                  onChanged?.();
                })
                .catch(() => toast.error("Couldn't undo")),
            );
          },
        },
      });
      close();
      onChanged?.();
    } catch {
      toast.error("Couldn't delete");
    } finally {
      setBusy(false);
    }
  }, [docId, projectId, close, onChanged]);

  const otherProjects = projects.filter((p) => p.id !== projectId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="Document actions"
        aria-expanded={open}
        className="text-muted opacity-0 group-hover:opacity-100 hover:text-violet transition-all p-1"
      >
        <MoreHorizontal size={13} strokeWidth={1.75} />
      </button>
      <AnimatePresence>
        {open ? (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.preventDefault();
                close();
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              onClick={(e) => e.preventDefault()}
              className="absolute right-0 top-full mt-1 w-52 bg-background border border-border shadow-[0_16px_32px_-16px_rgba(0,0,0,0.25)] overflow-hidden z-50"
            >
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={busy}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} strokeWidth={1.75} />}
                Duplicate
              </button>

              {otherProjects.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMoveOpen((v) => !v)}
                    aria-expanded={moveOpen}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <FolderInput size={13} strokeWidth={1.75} />
                    <span className="flex-1 text-left">Move to…</span>
                    <ChevronRight size={12} strokeWidth={2} className={`transition-transform ${moveOpen ? "rotate-90" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {moveOpen ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.16 }}
                        className="overflow-hidden bg-surface/60 border-y border-border max-h-48 overflow-y-auto"
                      >
                        {otherProjects.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleMove(p.id)}
                            disabled={busy}
                            className="w-full flex items-center gap-2 pl-8 pr-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-50 text-left"
                          >
                            <Check size={11} className="opacity-0" />
                            <span className="truncate">{p.name}</span>
                          </button>
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </>
              ) : null}

              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-rose/80 hover:text-rose hover:bg-rose/[0.05] transition-colors border-t border-border disabled:opacity-50"
              >
                <Trash2 size={13} strokeWidth={1.75} />
                Delete
              </button>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
