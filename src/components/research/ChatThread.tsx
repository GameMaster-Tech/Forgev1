"use client";

/**
 * ChatThread — editorial transcript surface.
 *
 * Design direction (post-redesign): bubbles are gone. Each turn reads
 * like an interview transcript — small uppercase byline + prose body,
 * single column, generous air. Role identity comes from a 2px violet
 * left rule on user turns (not a fill colour) and a typography shift
 * (display font for the user; body font for Forge).
 *
 * The signature detail is the "thinking" indicator: a 60px sliver
 * animates under the assistant's byline while the response streams.
 * No spinner, no "Thinking…" word — just a teletype pulse.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Rocket,
  RotateCcw,
  Search as SearchIcon,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import { Markdown } from "./Markdown";
import type { LiveTraceItem } from "@/hooks/useChatThread";
import type { ChatTurn } from "@/hooks/useChatThread";

const EASE = [0.22, 0.61, 0.36, 1] as const;
const MODEL_LABEL = "llama-3.3-70b";

export interface ChatThreadHandle {
  focus: () => void;
}

interface ChatThreadProps {
  messages: ChatTurn[];
  sending: boolean;
  loading: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  onReset: () => void;
  projectName?: string | null;
}

const SUGGESTED_PROMPTS: string[] = [
  "Summarise what this project is about so far.",
  "What sources should I read next? Suggest five with one-line reasons.",
  "What's the strongest counter-argument to my main claim?",
];

export const ChatThread = forwardRef<ChatThreadHandle, ChatThreadProps>(
  function ChatThread(
    { messages, sending, loading, error, onSend, onReset, projectName },
    ref,
  ) {
    const [draft, setDraft] = useState("");
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => composerRef.current?.focus(),
    }));

    // Autosize the textarea up to ~6 lines, then scroll inside.
    useLayoutEffect(() => {
      const el = composerRef.current;
      if (!el) return;
      el.style.height = "0";
      el.style.height = Math.min(el.scrollHeight, 180) + "px";
    }, [draft]);

    // Pin to the latest turn whenever the transcript grows.
    useEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [messages]);

    const submit = useCallback(
      async (text: string) => {
        if (!text.trim() || sending) return;
        setDraft("");
        await onSend(text);
      },
      [onSend, sending],
    );

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void submit(draft);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit(draft);
      }
    };

    const visible = useMemo(
      () => messages.filter((m) => m.role !== "system"),
      [messages],
    );
    const empty = visible.length === 0;

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Quiet status strip — only shows once the thread has content. */}
        {!empty ? (
          <div className="flex items-center gap-2 px-6 sm:px-10 py-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
              Chat · {visible.length} turn{visible.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={onReset}
              className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-violet transition-colors"
            >
              <RotateCcw size={11} strokeWidth={2} />
              New chat
            </button>
          </div>
        ) : null}

        {/* Transcript */}
        <div
          ref={scrollerRef}
          className="flex-1 min-h-0 overflow-y-auto bg-background"
        >
          <div className="max-w-[680px] mx-auto px-6 sm:px-10 py-10">
            {loading ? (
              <LoadingState />
            ) : empty ? (
              <EmptyState projectName={projectName} onPrompt={submit} />
            ) : (
              <ol className="space-y-10">
                <AnimatePresence initial={false}>
                  {visible.map((m) => (
                    <Turn key={m.id} turn={m} />
                  ))}
                </AnimatePresence>
              </ol>
            )}
            {error ? (
              <div className="mt-6 border-l-2 border-rose pl-4 py-2 text-[12.5px] text-rose leading-relaxed">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        {/* Composer — hairline top border, no card. The `composer-bare`
            class opts the textarea out of the global focus-visible
            violet outline so typing doesn't paint a blue block. */}
        <form
          onSubmit={handleSubmit}
          className="composer-bare border-t border-border bg-background"
        >
          <div className="max-w-[680px] mx-auto px-6 sm:px-10 py-4">
            <div className="flex items-end gap-3">
              <label htmlFor="forge-chat-composer" className="sr-only">
                Chat message
              </label>
              <textarea
                id="forge-chat-composer"
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  sending
                    ? "Forge is responding…"
                    : "Ask anything"
                }
                rows={1}
                disabled={sending}
                aria-label="Ask Forge"
                className="flex-1 min-w-0 resize-none bg-transparent text-[15px] text-foreground placeholder:text-muted leading-relaxed py-2 focus:outline-none disabled:opacity-60 font-display"
                style={{ caretColor: "var(--violet)" }}
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-violet hover:text-foreground disabled:text-muted/50 transition-colors py-2"
              >
                Send
                <ArrowRight
                  size={12}
                  strokeWidth={2.25}
                  className="transition-transform group-enabled:group-hover:translate-x-0.5"
                />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
              <span className="tabular-nums">{MODEL_LABEL}</span>
              <span className="text-border">/</span>
              <span>Enter sends · Shift + Enter newline</span>
            </div>
          </div>
        </form>
      </div>
    );
  },
);

/* ────── single turn ────── */

function Turn({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  const time = new Date(turn.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="relative"
    >
      {/* Byline */}
      <div
        className={`relative flex items-center gap-2 mb-2 ${isUser ? "pl-4" : "pl-0"}`}
      >
        {isUser ? (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-3 w-[2px] bg-violet"
          />
        ) : null}
        <span
          className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${
            isUser ? "text-violet" : "text-muted"
          }`}
        >
          {isUser ? "You" : "Forge"}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
          · {time}
        </span>
        {!isUser ? (
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted/70 font-medium">
            · {MODEL_LABEL}
          </span>
        ) : null}
        {turn.pending ? <ThinkingPulse /> : null}
      </div>

      {/* Live thinking trace — only on the assistant turn currently
          streaming OR on a completed turn that had tool activity. Shows
          one chip per tool call with diverse, accurate labels and a
          source-URL strip when the model is browsing the web. */}
      {!isUser && turn.liveTrace && turn.liveTrace.length > 0 ? (
        <LiveTrace items={turn.liveTrace} />
      ) : null}

      {/* Body — user turns render as plain text (preserving the
          author's punctuation); assistant turns parse markdown so
          links, code, bold, headers etc. render properly. */}
      {isUser ? (
        <div className="text-[15px] leading-[1.65] text-foreground whitespace-pre-wrap break-words pl-4 font-display tracking-[-0.01em]">
          {turn.content}
        </div>
      ) : (
        <div className="pl-0 break-words">
          {turn.content ? <Markdown text={turn.content} tight /> : null}
        </div>
      )}
      {/* Hidden — kept zero-width so the source diff stays minimal. */}
      <div style={{ display: "none" }}>
        {turn.content || (turn.pending ? " " : "")}
      </div>

      {/* Agent step chips — only on assistant turns that called tools. */}
      {!isUser && turn.steps && turn.steps.length > 0 ? (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] text-muted">
          <span className="uppercase tracking-[0.16em] font-medium opacity-70">
            Used
          </span>
          {turn.steps.map((s, i) => (
            <span
              key={`${s.tool}-${i}`}
              className="inline-flex items-center px-1.5 py-0.5 border border-border bg-background/60 font-mono"
              title={`turn ${s.turn} · ${s.durationMs}ms`}
            >
              {s.tool}
            </span>
          ))}
        </div>
      ) : null}
    </motion.li>
  );
}

/* ────── thinking indicator — sliding 1px sliver under the byline ────── */

function ThinkingPulse() {
  return (
    <span className="relative inline-block ml-2 w-[60px] h-px overflow-hidden align-middle bg-border/40">
      <motion.span
        aria-hidden
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{
          duration: 1.6,
          repeat: Infinity,
          ease: [0.4, 0, 0.6, 1],
        }}
        className="absolute inset-y-0 left-0 w-[60%] bg-gradient-to-r from-transparent via-violet to-transparent"
      />
    </span>
  );
}

/* ────── loading / empty ────── */

function LoadingState() {
  return (
    <div className="py-16 text-center">
      <span className="inline-block w-2 h-2 bg-violet rounded-full animate-pulse" />
      <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
        Loading conversation
      </p>
    </div>
  );
}

function EmptyState({
  projectName,
  onPrompt,
}: {
  projectName?: string | null;
  onPrompt: (text: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="py-12"
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-5 flex items-center gap-2">
        <Sparkles size={11} strokeWidth={2} className="text-violet" />
        Chat
      </p>
      <h1 className="font-display font-extrabold text-3xl sm:text-[2.25rem] text-foreground tracking-[-0.025em] leading-[1.1] mb-3">
        {projectName ? (
          <>
            What do you want to figure out about{" "}
            <span className="text-violet">{projectName}</span>?
          </>
        ) : (
          <>What do you want to figure out?</>
        )}
      </h1>
      <p className="text-[13px] text-muted leading-relaxed max-w-md mb-8">
        Forge keeps the whole conversation in context. Ask follow-ups,
        cite sources, save what&apos;s useful.
      </p>
      <ul className="space-y-2">
        {SUGGESTED_PROMPTS.map((p, i) => (
          <motion.li
            key={p}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: EASE, delay: 0.08 + i * 0.04 }}
          >
            <button
              type="button"
              onClick={() => onPrompt(p)}
              className="group w-full text-left flex items-start gap-3 py-2 border-t border-border first:border-t-0 hover:bg-violet/[0.04] transition-colors -mx-2 px-2"
            >
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted group-hover:text-violet transition-colors mt-0.5 tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 text-[14px] text-foreground/85 leading-snug group-hover:text-foreground transition-colors">
                {p}
              </span>
              <ArrowRight
                size={12}
                strokeWidth={2}
                className="text-muted opacity-0 group-hover:opacity-100 group-hover:text-violet transition-all mt-1"
              />
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ────── live thinking trace ────── */

/**
 * Renders the assistant's live thinking surface during a stream:
 * one stacked row per tool call, each row carrying a tool-specific
 * icon, a humanized label that updates from "Searching the web for
 * 'X'…" → "Found 6 web results", and (for web tools) a horizontal
 * strip of the source domains the model is currently browsing.
 *
 * Anatomy:
 *
 *   ▍ icon · Searching the web for "q3 hiring benchmarks" …
 *           [stripe.com] [bls.gov] [a16z.com]
 *
 * Inflight rows show a sliding sliver animation; completed rows
 * collapse to a check mark and stay readable in the thread.
 */
function LiveTrace({ items }: { items: LiveTraceItem[] }) {
  if (items.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="mb-3 ml-0 border-l border-border pl-3 space-y-1.5"
    >
      {items.map((it) => (
        <TraceRow key={it.key} item={it} />
      ))}
    </motion.div>
  );
}

function TraceRow({ item }: { item: LiveTraceItem }) {
  const Icon = iconForTool(item.tool);
  const tone = item.errored
    ? "text-rose"
    : item.inflight
      ? "text-violet"
      : "text-muted";
  return (
    <div className="flex items-start gap-2">
      <span className={`shrink-0 mt-[3px] ${tone}`} aria-hidden>
        {item.inflight ? (
          <Loader2 size={11} strokeWidth={2} className="animate-spin" />
        ) : item.errored ? (
          <Icon size={11} strokeWidth={2} />
        ) : (
          <CheckCircle2 size={11} strokeWidth={2} className="text-green/80" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Icon
            size={11}
            strokeWidth={2}
            className={`${tone} opacity-70 mr-0.5 inline-block align-baseline`}
          />
          <span
            className={`text-[12.5px] leading-snug ${
              item.inflight ? "text-foreground" : item.errored ? "text-rose" : "text-muted"
            }`}
          >
            {item.label}
            {item.inflight ? "…" : null}
          </span>
          {item.summary && !item.inflight ? (
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted/70 font-medium tabular-nums">
              · {item.summary}
            </span>
          ) : null}
          {item.durationMs && !item.inflight ? (
            <span className="text-[10px] text-muted/50 tabular-nums">
              {item.durationMs}ms
            </span>
          ) : null}
        </div>
        {/* Currently-browsing source strip — only on web tools. */}
        {item.sources && item.sources.length > 0 ? (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {item.sources.map((s, i) => (
              <a
                key={`${s.url}-${i}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-background/60 text-[10px] text-muted hover:text-violet hover:border-violet/40 transition-colors"
                title={s.title ?? s.url}
              >
                <Globe size={9} strokeWidth={2} className="opacity-60 group-hover:opacity-100" />
                <span className="font-mono">{hostnameOf(s.url)}</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function iconForTool(tool: string) {
  switch (tool) {
    case "thinking":
      return Brain;
    case "research_search":
    case "research_answer":
      return SearchIcon;
    case "docs_list":
      return ListChecks;
    case "docs_read":
      return BookOpen;
    case "docs_create":
    case "docs_update":
      return FileText;
    case "calendar_list_events":
    case "calendar_create_event":
    case "calendar_update_event":
    case "calendar_delete_event":
      return CalendarIcon;
    case "tasks_list":
    case "tasks_create":
      return ListChecks;
    case "habits_create":
      return Rocket;
    case "goals_create":
      return Target;
    case "error":
      return Wand2;
    default:
      return Sparkles;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 32);
  }
}
