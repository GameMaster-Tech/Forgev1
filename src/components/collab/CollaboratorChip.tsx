"use client";

/**
 * CollaboratorChip — surfaces "Currently viewing" state next to an
 * invited collaborator's name in the Sharing dialog. Small, restrained.
 */

import { Eye, Edit3 } from "lucide-react";
import { colourHexFor, colourSoftFor } from "@/lib/collab";
import type { PresenceActivity } from "@/lib/collab";

interface Props {
  uid: string;
  activity?: PresenceActivity;
}

export function CollaboratorChip({ uid, activity }: Props) {
  if (!activity) return null;
  const colour = colourHexFor(uid);
  const soft = colourSoftFor(uid);
  const editing = activity.type === "typing" || activity.type === "dragging";
  const Icon = editing ? Edit3 : Eye;
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5"
      style={{ background: soft, color: colour }}
    >
      <Icon size={8} strokeWidth={2.25} />
      {editing ? "Editing now" : "Viewing"}
    </span>
  );
}
