/**
 * Public collab API. Consumers should import only from here.
 *
 *   import { useCollab, usePresence, PresenceStrip, LiveBadge } from "@/lib/collab";
 */

export type {
  CollabController,
  CollabDocId,
  CollabDocKind,
  CollabProvider,
  CollabStatus,
  CursorPayload,
  PresenceActivity,
  PresenceState,
} from "./types";

export { CURSOR_PALETTE, CURSOR_PALETTE_SOFT } from "./types";

export {
  acquireDoc,
  editorFragment,
  subtasksMap,
  assertionsMap,
  blocksMap,
  activeDocCount,
  debugDocs,
  kindOf,
} from "./doc-factory";

export {
  paletteIndexFor,
  colourHexFor,
  colourSoftFor,
  initialsFor,
} from "./colors";

export { FirestoreCollabProvider } from "./firestore-provider";
