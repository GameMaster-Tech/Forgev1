/**
 * SemanticFlash — TipTap decoration extension that paints a soft flash
 * across the active document when the Semantic Reactivity layer reports
 * a cross-document contradiction.
 *
 *   • The extension owns NO state. It exposes an `applySemanticFlash`
 *     storage method that the `useSemanticReactivity` hook calls when a
 *     new conflict batch arrives. The storage triggers a brief
 *     `flashedAt` timestamp; the ProseMirror plugin reads that
 *     timestamp on every transaction and paints a fading decoration
 *     across the whole document until the flash has expired.
 *
 *   • The visual is a single absolutely-positioned widget rendered at
 *     position 0; it uses Forge's brand violet at low opacity so the
 *     flash reads as ambient feedback, not a modal.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SemanticFlashStorage {
  /** Timestamp (ms epoch) the flash was last triggered, or `null`. */
  flashedAt: number | null;
  /** How many conflicts triggered the most recent flash. */
  lastCount: number;
  /** Short reason summary, surfaced in the corner pill. */
  lastReason: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    semanticFlash: {
      /** Trigger a flash. Returns true so chain() composes. */
      flashSemantic: (payload: { count: number; reason: string }) => ReturnType;
      /** Clear the flash immediately. */
      clearSemantic: () => ReturnType;
    };
  }
  interface Storage {
    semanticFlash: SemanticFlashStorage;
  }
}

const PLUGIN_KEY = new PluginKey("forge-semantic-flash");
const FLASH_DURATION_MS = 1_400;

export const SemanticFlash = Extension.create({
  name: "semanticFlash",

  addStorage(): SemanticFlashStorage {
    return { flashedAt: null, lastCount: 0, lastReason: "" };
  },

  addCommands() {
    return {
      flashSemantic:
        ({ count, reason }) =>
        ({ editor, tr, dispatch }) => {
          editor.storage.semanticFlash.flashedAt = Date.now();
          editor.storage.semanticFlash.lastCount = count;
          editor.storage.semanticFlash.lastReason = reason;
          if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { flashedAt: Date.now() }));
          return true;
        },
      clearSemantic:
        () =>
        ({ editor, tr, dispatch }) => {
          editor.storage.semanticFlash.flashedAt = null;
          editor.storage.semanticFlash.lastCount = 0;
          editor.storage.semanticFlash.lastReason = "";
          if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { flashedAt: null }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    // Capture storage by reference. The plugin closure reads it on
    // every decoration call; the extension instance owns the array so
    // mutations through `flashSemantic` / `clearSemantic` propagate.
    const storage = this.storage as SemanticFlashStorage;
    return [
      new Plugin({
        key: PLUGIN_KEY,
        state: {
          init: () => ({ flashedAt: null as number | null }),
          apply(tr, value) {
            const meta = tr.getMeta(PLUGIN_KEY) as
              | { flashedAt: number | null }
              | undefined;
            if (meta) return { flashedAt: meta.flashedAt };
            return value;
          },
        },
        props: {
          decorations(state) {
            const pluginState = PLUGIN_KEY.getState(state) as
              | { flashedAt: number | null }
              | undefined;
            const flashedAt = pluginState?.flashedAt ?? null;
            if (!flashedAt) return DecorationSet.empty;
            const elapsed = Date.now() - flashedAt;
            if (elapsed > FLASH_DURATION_MS) return DecorationSet.empty;

            const intensity = 1 - elapsed / FLASH_DURATION_MS;
            const count = storage.lastCount;
            const reason = storage.lastReason;
            const docEnd = state.doc.content.size;
            const widget = Decoration.widget(
              0,
              () => buildFlashElement(intensity, count, reason),
              { side: -1 },
            );
            // A fading background-color decoration across the full doc.
            const inline = Decoration.inline(
              0,
              Math.max(0, docEnd),
              { class: "forge-semantic-flash" },
            );
            return DecorationSet.create(state.doc, [widget, inline]);
          },
        },
      }),
    ];
  },
});

function buildFlashElement(
  intensity: number,
  count: number,
  reason: string,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-forge-semantic-flash", "");
  wrap.style.position = "absolute";
  wrap.style.top = "0";
  wrap.style.right = "0";
  wrap.style.pointerEvents = "none";
  wrap.style.transition = "opacity 200ms ease-out";
  wrap.style.opacity = String(Math.max(0, intensity).toFixed(3));
  wrap.style.zIndex = "30";

  const pill = document.createElement("div");
  pill.style.padding = "6px 10px";
  pill.style.margin = "6px";
  pill.style.background = "rgba(124, 58, 237, 0.16)";
  pill.style.border = "1px solid rgba(124, 58, 237, 0.45)";
  pill.style.color = "rgb(76, 29, 149)";
  pill.style.fontFamily =
    "var(--font-mono, ui-monospace, SFMono-Regular, monospace)";
  pill.style.fontSize = "10px";
  pill.style.letterSpacing = "0.14em";
  pill.style.textTransform = "uppercase";
  pill.style.whiteSpace = "nowrap";
  pill.textContent = `Semantic flash · ${count} conflict${count === 1 ? "" : "s"}${
    reason ? ` · ${truncate(reason, 80)}` : ""
  }`;
  wrap.appendChild(pill);
  return wrap;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
