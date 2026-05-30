/**
 * Image — a block-level image node for the editor.
 *
 * Deliberately dependency-free (no @tiptap/extension-image): a small,
 * self-contained node that parses/renders `<img>` and survives the
 * `getHTML()` / `setContent()` round-trip Forge persists to Firestore.
 *
 * Upload (paste / drag-drop → Firebase Storage) is handled in
 * ForgeEditor via `handlePaste` / `handleDrop`, which call the host's
 * upload function and then insert this node with the resulting URL. The
 * extension itself only owns the schema + a `setImage` command.
 */

import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string; title?: string }) => ReturnType;
    };
  }
}

export const Image = Node.create({
  name: "image",
  group: "block",
  inline: false,
  draggable: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        class: "forge-editor-image",
        loading: "lazy",
      }),
    ];
  },

  addCommands() {
    return {
      setImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
