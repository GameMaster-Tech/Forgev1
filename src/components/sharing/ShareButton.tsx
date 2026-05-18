"use client";

/**
 * ShareButton — tiny trigger for the SharingDialog. Designed to drop
 * into any page header (Sync / Pulse / Lattice / Calendar / Projects).
 */

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Share2 } from "lucide-react";
import { SharingDialog } from "./SharingDialog";
import type { ShareableResource } from "@/lib/sharing";
import { getSharingState, subscribeSharing } from "@/lib/sharing";
import { useEffect } from "react";

interface Props {
  resource: ShareableResource;
  /** Visual variant. Defaults to "outline". */
  variant?: "outline" | "ghost";
}

export function ShareButton({ resource, variant = "outline" }: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const tick = () => setCount(getSharingState(resource.kind, resource.id).grants.length);
    tick();
    return subscribeSharing(tick);
  }, [resource.kind, resource.id]);

  const base = "inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-2 transition-colors duration-150";
  const cls =
    variant === "outline"
      ? `${base} border border-border text-foreground hover:border-violet hover:text-violet focus-ring`
      : `${base} text-muted hover:text-foreground`;

  return (
    <>
      <button onClick={() => setOpen(true)} className={cls} aria-haspopup="dialog">
        <Share2 size={11} strokeWidth={2} />
        Share
        {count > 0 && (
          <span className="text-[9px] tabular-nums bg-violet text-white px-1 py-0.5 -my-0.5">{count}</span>
        )}
      </button>
      <AnimatePresence>
        {open && <SharingDialog resource={resource} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
