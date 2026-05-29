/**
 * Slash command catalog for ForgeEditor.
 *
 * Each command is a block the user can insert by typing "/" at the
 * start of an empty block and picking from the menu. `run` receives a
 * focused editor whose trigger fragment ("/heading") has already been
 * deleted, so it only needs to apply the block transform.
 *
 * Kept dependency-free: no @tiptap/suggestion. Detection + positioning
 * live in ForgeEditor; this file owns the catalog and the fuzzy filter
 * so the command set is easy to extend without touching wiring.
 */

import type { Editor } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Code,
  Table,
  Type,
  type LucideIcon,
} from "lucide-react";

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Lowercase tokens matched against the query. `label` is always matched too. */
  keywords: string[];
  run: (editor: Editor) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    hint: "Plain paragraph",
    icon: Type,
    keywords: ["text", "paragraph", "body", "p"],
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "h1",
    label: "Heading 1",
    hint: "Large section title",
    icon: Heading1,
    keywords: ["heading", "h1", "title", "large"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "Medium section title",
    icon: Heading2,
    keywords: ["heading", "h2", "subtitle", "medium"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "Small label heading",
    icon: Heading3,
    keywords: ["heading", "h3", "label", "small"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    hint: "Unordered list",
    icon: List,
    keywords: ["bullet", "list", "unordered", "ul", "point"],
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    hint: "Ordered list",
    icon: ListOrdered,
    keywords: ["number", "numbered", "ordered", "ol", "list"],
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    hint: "Blockquote",
    icon: Quote,
    keywords: ["quote", "blockquote", "citation"],
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    hint: "Monospaced code",
    icon: Code,
    keywords: ["code", "snippet", "monospace", "pre"],
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    hint: "Horizontal rule",
    icon: Minus,
    keywords: ["divider", "rule", "hr", "line", "separator"],
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Database table",
    hint: "Structured rows & columns",
    icon: Table,
    keywords: ["table", "database", "grid", "rows", "columns"],
    run: (editor) => editor.chain().focus().insertDataTable().run(),
  },
];

/** Fuzzy-ish filter: substring match on label or any keyword. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.includes(q)),
  );
}
