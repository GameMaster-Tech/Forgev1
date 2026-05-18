/**
 * Sharing — re-export of the ShareGrant model with cross-domain
 * convenience types. The underlying contract lives in
 * `src/lib/scheduler/share.ts`; this module gives non-calendar
 * features (Sync / Pulse / Lattice) a clean import path.
 */

import type { ShareGrant, ShareRole } from "../scheduler/types";
import type { PublicLinkShare } from "../scheduler/share";

export type { ShareGrant, ShareRole, PublicLinkShare };

export type ShareableKind = "project" | "calendar" | "event" | "task" | "goal";

export interface ShareableResource {
  kind: ShareableKind;
  id: string;
  /** Display label shown in the sharing dialog header. */
  label: string;
}

export interface SharingState {
  grants: ShareGrant[];
  publicLink: PublicLinkShare | null;
}
