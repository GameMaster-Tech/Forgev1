/**
 * CommentMark — TipTap inline mark that anchors a Firestore comment
 * to a range of text.
 *
 * Each comment has a single `commentId` attribute stored as
 * `data-comment-id` on the rendered `<mark>`. The mark survives
 * HTML round-trips (parse + render) so re-loading the doc keeps the
 * highlight intact.
 *
 * Click handling and the side panel both look up comments via the
 * `commentId`. The mark is purely visual + addressable.
 */

import { Mark, mergeAttributes } from "@tiptap/core";

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      /** Wrap the current selection in a comment highlight. */
      addComment: (commentId: string) => ReturnType;
      /** Remove a comment highlight by id (resolves / deletes). */
      removeComment: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: "comment",
  exitable: true,
  inclusive: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) => {
          if (!attrs.commentId) return {};
          return { "data-comment-id": String(attrs.commentId) };
        },
      },
      resolved: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-resolved") === "true",
        renderHTML: (attrs) => ({
          "data-resolved": attrs.resolved ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark[data-comment-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "forge-comment-mark",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      addComment:
        (commentId: string) =>
        ({ chain }) => {
          return chain()
            .setMark(this.name, { commentId, resolved: false })
            .run();
        },
      removeComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          // Walk the doc and strip any comment mark whose id matches.
          let modified = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return true;
            const mark = node.marks.find(
              (m) =>
                m.type.name === this.name &&
                String(m.attrs.commentId) === commentId,
            );
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark.type);
              modified = true;
            }
            return true;
          });
          if (modified && dispatch) dispatch(tr);
          return modified;
        },
    };
  },
});
