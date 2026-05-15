"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Typography from "@tiptap/extension-typography";
import { InlineMath, BlockMath } from "./extensions/Math";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Highlighter,
  Link as LinkIcon,
  Undo,
  Redo,
  Minus,
  ChevronDown,
  Sparkles,
  Loader2,
  PenLine,
  Shrink,
  Expand,
  SpellCheck,
  GraduationCap,
  MessageSquare,
  X,
  Check,
  RotateCcw,
  Sigma,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

type AICommand =
  | "continue"
  | "summarize"
  | "expand"
  | "simplify"
  | "fix-grammar"
  | "make-concise"
  | "rewrite-formal"
  | "rewrite-casual";

interface AICommandOption {
  id: AICommand;
  label: string;
  icon: typeof Sparkles;
  description: string;
  needsSelection: boolean;
}

const aiCommands: AICommandOption[] = [
  {
    id: "continue",
    label: "Continue writing",
    icon: PenLine,
    description: "AI continues from cursor",
    needsSelection: false,
  },
  {
    id: "expand",
    label: "Expand",
    icon: Expand,
    description: "Add more detail",
    needsSelection: true,
  },
  {
    id: "make-concise",
    label: "Make concise",
    icon: Shrink,
    description: "Tighten the prose",
    needsSelection: true,
  },
  {
    id: "fix-grammar",
    label: "Fix grammar",
    icon: SpellCheck,
    description: "Correct errors",
    needsSelection: true,
  },
  {
    id: "simplify",
    label: "Simplify",
    icon: MessageSquare,
    description: "Simpler language",
    needsSelection: true,
  },
  {
    id: "rewrite-formal",
    label: "More formal",
    icon: GraduationCap,
    description: "Academic tone",
    needsSelection: true,
  },
  {
    id: "summarize",
    label: "Summarize",
    icon: Shrink,
    description: "Key points only",
    needsSelection: true,
  },
  {
    id: "rewrite-casual",
    label: "More casual",
    icon: MessageSquare,
    description: "Conversational tone",
    needsSelection: true,
  },
];

export interface EditorHandle {
  getPlainText: () => string;
  jumpToText: (needle: string) => boolean;
}

interface ForgeEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  onWordCountChange?: (count: number) => void;
  onReady?: (handle: EditorHandle) => void;
}

/* â”€â”€â”€ Toolbar button â”€â”€â”€ */
function Btn({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 transition-colors duration-150 ${
        active
          ? "text-foreground bg-surface"
          : "text-muted hover:text-foreground"
      } disabled:opacity-20 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

/* â”€â”€â”€ Block type dropdown â”€â”€â”€ */
function BlockTypeSelect({
  currentBlock,
  onSelect,
}: {
  currentBlock: string;
  onSelect: (type: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const types = [
    { id: "p", label: "Body" },
    { id: "h1", label: "Heading 1" },
    { id: "h2", label: "Heading 2" },
    { id: "h3", label: "Label" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-foreground border border-border hover:border-foreground/20 transition-colors duration-150 min-w-[100px]"
      >
        <span>{currentBlock}</span>
        <ChevronDown
          size={11}
          className={`ml-auto transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.14 }}
            className="absolute top-full left-0 mt-1 bg-surface border border-border z-50 min-w-[160px]"
          >
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelect(t.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[12px] transition-colors duration-100 flex items-center gap-2 ${
                  currentBlock === t.label
                    ? "text-foreground bg-background border-l-2 border-violet"
                    : "text-muted hover:text-foreground hover:bg-background"
                }`}
              >
                {t.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* â”€â”€â”€ AI Command Bar â”€â”€â”€ */
function AICommandBar({
  open,
  onClose,
  onCommand,
  hasSelection,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (cmd: AICommand) => void;
  hasSelection: boolean;
  loading: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <AICommandBarInner
          onClose={onClose}
          onCommand={onCommand}
          hasSelection={hasSelection}
          loading={loading}
        />
      )}
    </AnimatePresence>
  );
}

function AICommandBarInner({
  onClose,
  onCommand,
  hasSelection,
  loading,
}: {
  onClose: () => void;
  onCommand: (cmd: AICommand) => void;
  hasSelection: boolean;
  loading: boolean;
}) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = aiCommands.filter((cmd) => {
    if (filter && !cmd.label.toLowerCase().includes(filter.toLowerCase()))
      return false;
    if (!hasSelection && cmd.needsSelection) return false;
    return true;
  });

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: 0.18, ease }}
        className="absolute right-0 top-full mt-2 w-80 bg-surface border border-border shadow-[0_12px_32px_-16px_rgba(0,0,0,0.25)] z-50 overflow-hidden"
      >
        {/* Search header */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2.5">
            <Sparkles size={11} className="text-violet" />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground">
              AI command
            </span>
            <span className="h-px flex-1 bg-border" />
            <span
              className={`text-[9px] font-medium uppercase tracking-[0.12em] ${
                hasSelection ? "text-green" : "text-muted"
              }`}
            >
              {hasSelection ? "Selection" : "No selection"}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-background border border-border focus-within:border-violet/50 px-3 py-2 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={loading ? "Generating..." : "Type a command"}
              disabled={loading}
              className="flex-1 text-[12px] bg-transparent focus:outline-none placeholder:text-muted text-foreground disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
                if (e.key === "Enter" && filtered.length > 0) {
                  onCommand(filtered[0].id);
                }
              }}
            />
            {loading && (
              <Loader2
                size={12}
                className="text-violet animate-spin shrink-0"
              />
            )}
          </div>
        </div>

        {/* Commands */}
        {!loading && (
          <div className="py-1 max-h-[300px] overflow-y-auto">
            {filtered.map((cmd) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => onCommand(cmd.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-background transition-colors duration-100 group"
                >
                  <div className="w-7 h-7 border border-border flex items-center justify-center group-hover:border-violet/40 transition-colors">
                    <Icon
                      size={12}
                      className="text-muted group-hover:text-violet transition-colors"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-foreground font-medium">
                      {cmd.label}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {cmd.description}
                    </div>
                  </div>
                  {cmd.needsSelection && (
                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted font-mono">
                      sel
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-[10px] uppercase tracking-[0.15em] text-muted">
                  {hasSelection
                    ? "No matching commands"
                    : "Select text to use AI editing"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border">
          <span className="text-[9px] uppercase tracking-[0.15em] text-muted font-mono">
            {hasSelection
              ? "â†µ enter Â· esc to close"
              : "tip Â· select text for more options"}
          </span>
        </div>
      </motion.div>
    </>
  );
}

/* â”€â”€â”€ AI Result Preview â”€â”€â”€ */
function AIResultPreview({
  result,
  onAccept,
  onReject,
  onRetry,
}: {
  result: string;
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease }}
      className="mx-auto max-w-[720px] px-6 mb-6"
    >
      <div className="relative border border-border border-l-[2px] border-l-violet bg-surface/70 backdrop-blur-sm p-6">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, rgba(37,99,235,0.035) 0%, transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-2 mb-4">
          <Sparkles size={11} className="text-violet" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-violet">
            AI suggestion
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="relative text-[14px] text-foreground leading-[1.75] whitespace-pre-wrap mb-5">
          {result}
        </div>
        <div className="relative flex items-center gap-2">
          <button
            onClick={onAccept}
            className="flex items-center gap-2 bg-violet text-white text-[10px] font-medium uppercase tracking-[0.12em] px-4 py-2 hover:bg-violet/90 transition-colors"
          >
            <Check size={12} strokeWidth={2.25} />
            Accept
          </button>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 text-foreground border border-border text-[10px] font-medium uppercase tracking-[0.12em] px-4 py-2 hover:border-foreground/30 transition-colors"
          >
            <RotateCcw size={12} />
            Retry
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-2 text-muted text-[10px] font-medium uppercase tracking-[0.12em] px-4 py-2 hover:text-foreground transition-colors"
          >
            <X size={12} />
            Discard
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function ForgeEditor({
  content = "",
  onUpdate,
  onWordCountChange,
  onReady,
}: ForgeEditorProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<AICommand | null>(null);
  const [selectedText, setSelectedText] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: "Begin writing...",
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class:
            "text-cyan underline underline-offset-3 decoration-1 hover:opacity-75 cursor-pointer transition-opacity",
        },
      }),
      Typography,
      InlineMath,
      BlockMath,
    ],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate?.(html);
      const text = editor.state.doc.textContent;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      onWordCountChange?.(words);
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) {
        setSelectedText(editor.state.doc.textBetween(from, to, " "));
      } else {
        setSelectedText("");
      }
    },
  });

  useEffect(() => {
    if (editor) {
      const text = editor.state.doc.textContent;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      onWordCountChange?.(words);
    }
  }, [editor, onWordCountChange]);

  /* Expose a small handle to the parent so features like Claim Check can
     read the plaintext and scroll+highlight a matched claim without owning
     the editor instance. */
  useEffect(() => {
    if (!editor || !onReady) return;
    const handle: EditorHandle = {
      getPlainText: () => editor.state.doc.textContent,
      jumpToText: (needle: string) => {
        const haystack = editor.state.doc.textContent;
        if (!needle) return false;
        const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
        if (idx === -1) return false;
        // Map plain-text index back to a ProseMirror position by walking text nodes.
        let pos = 0;
        let running = 0;
        let found = false;
        editor.state.doc.descendants((node, nodePos) => {
          if (found) return false;
          if (node.isText) {
            const len = node.text?.length ?? 0;
            if (running + len >= idx) {
              pos = nodePos + (idx - running);
              found = true;
              return false;
            }
            running += len;
          }
          return true;
        });
        if (!found) return false;
        const end = pos + needle.length;
        editor.chain().focus().setTextSelection({ from: pos, to: end }).run();
        // Scroll the selection into view
        const { node } = editor.view.domAtPos(pos);
        const target =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : (node.parentElement as HTMLElement | null);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      },
    };
    onReady(handle);
  }, [editor, onReady]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  const handleBlockTypeSelect = useCallback(
    (type: string) => {
      if (!editor) return;
      switch (type) {
        case "p":
          editor.chain().focus().setParagraph().run();
          break;
        case "h1":
          editor.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case "h2":
          editor.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case "h3":
          editor.chain().focus().toggleHeading({ level: 3 }).run();
          break;
      }
    },
    [editor]
  );

  const handleAICommand = useCallback(
    async (command: AICommand) => {
      if (!editor) return;
      setAiLoading(true);
      setLastCommand(command);

      const text = selectedText || editor.state.doc.textContent.slice(-500);
      const context = editor.state.doc.textContent.slice(0, 1000);

      try {
        const res = await fetch("/api/ai/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, text, context }),
        });
        const data = await res.json();

        if (data.result) {
          setAiResult(data.result);
          setAiOpen(false);
        }
      } catch {
        setAiResult(null);
      } finally {
        setAiLoading(false);
      }
    },
    [editor, selectedText]
  );

  const handleAcceptAI = useCallback(() => {
    if (!editor || !aiResult) return;

    if (selectedText) {
      editor.chain().focus().insertContent(aiResult).run();
    } else {
      editor.chain().focus().insertContent(aiResult).run();
    }

    setAiResult(null);
    setLastCommand(null);
  }, [editor, aiResult, selectedText]);

  const handleRetryAI = useCallback(() => {
    if (lastCommand) {
      setAiResult(null);
      handleAICommand(lastCommand);
    }
  }, [lastCommand, handleAICommand]);

  if (!editor) return null;

  const currentBlock = editor.isActive("heading", { level: 1 })
    ? "Heading 1"
    : editor.isActive("heading", { level: 2 })
      ? "Heading 2"
      : editor.isActive("heading", { level: 3 })
        ? "Label"
        : editor.isActive("bulletList")
          ? "List"
          : editor.isActive("orderedList")
            ? "Numbered"
            : editor.isActive("blockquote")
              ? "Quote"
              : "Body";

  const hasSelection = selectedText.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* â”€â”€â”€ Floating Toolbar â”€â”€â”€ */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="mx-3 mt-2 shrink-0 relative z-20"
      >
        <div className="relative flex items-center gap-0.5 px-3 py-1.5 border border-border bg-surface/80 backdrop-blur-md shadow-[0_8px_24px_-16px_rgba(0,0,0,0.2)]">

          {/* Block type selector */}
          <BlockTypeSelect
            currentBlock={currentBlock}
            onSelect={handleBlockTypeSelect}
          />

          <Sep />

          {/* Undo/Redo */}
          <Btn
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo size={15} />
          </Btn>

          <Sep />

          {/* Text formatting â€” warm group */}
          <Btn
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold"
          >
            <Bold size={15} strokeWidth={2.5} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic"
          >
            <Italic size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline"
          >
            <UnderlineIcon size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough"
          >
            <Strikethrough size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            active={editor.isActive("highlight")}
            title="Highlight"
          >
            <Highlighter size={15} />
          </Btn>

          <Sep />

          {/* Structure â€” violet group */}
          <Btn
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            active={editor.isActive("heading", { level: 1 })}
            title="Heading 1"
          >
            <Heading1 size={15} />
          </Btn>
          <Btn
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            active={editor.isActive("heading", { level: 2 })}
            title="Heading 2"
          >
            <Heading2 size={15} />
          </Btn>
          <Btn
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            active={editor.isActive("heading", { level: 3 })}
            title="Heading 3"
          >
            <Heading3 size={15} />
          </Btn>

          <Sep />

          {/* Lists â€” green group */}
          <Btn
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet list"
          >
            <List size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered list"
          >
            <ListOrdered size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Quote"
          >
            <Quote size={15} />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Divider"
          >
            <Minus size={15} />
          </Btn>

          <Sep />

          {/* Link + math â€” cyan group */}
          <Btn
            onClick={addLink}
            active={editor.isActive("link")}
            title="Link"
          >
            <LinkIcon size={15} />
          </Btn>

          <Btn
            onClick={() => {
              const latex = window.prompt(
                "Inline LaTeX (e.g. a^2 + b^2 = c^2):",
                ""
              );
              if (latex !== null && latex.trim()) {
                editor.chain().focus().insertInlineMath(latex.trim()).run();
              }
            }}
            active={editor.isActive("inlineMath")}
            title="Inline math  ($â€¦$)"
          >
            <Sigma size={15} />
          </Btn>
          <Btn
            onClick={() => {
              const latex = window.prompt(
                "Block LaTeX (e.g. \\int_0^\\infty e^{-x}\\,dx = 1):",
                ""
              );
              if (latex !== null && latex.trim()) {
                editor.chain().focus().insertBlockMath(latex.trim()).run();
              }
            }}
            active={editor.isActive("blockMath")}
            title="Block math  ($$â€¦$$)"
          >
            <span className="font-mono text-[11px] font-bold tracking-tight">
              Î£âˆ«
            </span>
          </Btn>

          <Sep />

          {/* AI Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAiOpen(!aiOpen)}
              title="AI Assistant"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] border transition-colors duration-150 ${
                aiOpen || aiLoading
                  ? "text-white bg-violet border-violet"
                  : "text-violet border-violet/30 hover:bg-violet/[0.06]"
              }`}
            >
              {aiLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} strokeWidth={2.25} />
              )}
              <span className="hidden sm:inline">AI</span>
            </button>

            <AICommandBar
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              onCommand={handleAICommand}
              hasSelection={hasSelection}
              loading={aiLoading}
            />
          </div>

          {/* Writing indicator */}
          <div className="ml-auto flex items-center gap-2">
            <AnimatePresence>
              {isFocused && !aiLoading && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-1.5 overflow-hidden px-2.5 py-1 border border-border"
                >
                  <div className="w-1 h-1 bg-foreground" />
                  <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted whitespace-nowrap">
                    Writing
                  </span>
                </motion.div>
              )}
              {aiLoading && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-1.5 overflow-hidden px-2.5 py-1 border border-violet/30"
                >
                  <div className="w-1 h-1 bg-violet" />
                  <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-violet whitespace-nowrap">
                    AI thinking
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* â”€â”€â”€ Editor canvas â”€â”€â”€ */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-[720px] mx-auto pt-16 pb-40 px-6">
          <EditorContent editor={editor} />
        </div>

        {/* AI Result Preview */}
        <AnimatePresence>
          {aiResult && (
            <AIResultPreview
              result={aiResult}
              onAccept={handleAcceptAI}
              onReject={() => {
                setAiResult(null);
                setLastCommand(null);
              }}
              onRetry={handleRetryAI}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
