"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Loader2,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useResearchStore, type Source } from "@/store/research";
import { useAuth } from "@/context/AuthContext";
import { saveResearchQuery } from "@/lib/firebase/firestore";

const ease = [0.22, 0.61, 0.36, 1] as const;

const sampleQueries = [
  { text: "Sleep deprivation and judicial decisions", tag: "Neuroscience" },
  { text: "CRISPR gene therapy clinical trials 2024", tag: "Biotech" },
  { text: "Effects of remote work on productivity", tag: "Social science" },
];

export default function ResearchPanel() {
  const { user } = useAuth();
  const {
    messages,
    loading,
    setCurrentQuery,
    addMessage,
    setLoading,
    updateSource,
  } = useResearchStore();

  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const verifyCitation = async (
    messageId: string,
    sourceIndex: number,
    source: Source
  ) => {
    updateSource(messageId, sourceIndex, { verifying: true });

    try {
      const res = await fetch("/api/verify-citation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: source.title,
          author: source.author || "",
        }),
      });

      const data = await res.json();

      if (data.verified) {
        updateSource(messageId, sourceIndex, {
          verified: true,
          doi: data.doi,
          journal: data.journal,
          year: data.year,
          verifying: false,
        });
      } else {
        updateSource(messageId, sourceIndex, {
          verified: false,
          verifying: false,
        });
      }
    } catch {
      updateSource(messageId, sourceIndex, {
        verified: false,
        verifying: false,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputValue.trim();
    if (!query || loading) return;

    setInputValue("");
    setCurrentQuery(query);
    addMessage({ role: "user", content: query });
    setLoading(true);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "answer" }),
      });

      const data = await res.json();

      if (data.error) {
        addMessage({ role: "assistant", content: `Error: ${data.error}` });
      } else if (data.type === "answer") {
        const sources: Source[] = (data.citations || []).map((c: Source) => ({
          title: c.title,
          url: c.url,
          text: c.text,
          publishedDate: c.publishedDate,
          author: c.author,
        }));

        const content =
          data.answer ||
          "No answer could be generated. Try refining your query.";
        addMessage({ role: "assistant", content, sources });

        if (user?.uid) {
          saveResearchQuery(user.uid, null, {
            query,
            answer: content,
            sourceCount: sources.length,
            verifiedCount: 0,
          }).catch(() => {});
        }

        const lastMsg = useResearchStore.getState().messages;
        const assistantMsg = lastMsg[lastMsg.length - 1];
        if (assistantMsg?.sources) {
          assistantMsg.sources.forEach((source, idx) => {
            verifyCitation(assistantMsg.id, idx, source);
          });
        }
      } else {
        const sources: Source[] = (data.results || []).map((r: Source) => ({
          title: r.title,
          url: r.url,
          text: r.text,
          highlights: r.highlights,
          publishedDate: r.publishedDate,
          author: r.author,
        }));

        addMessage({
          role: "assistant",
          content:
            sources.length > 0
              ? `Found ${sources.length} sources for your query.`
              : "No relevant sources found. Try refining your query.",
          sources,
        });
      }
    } catch {
      addMessage({
        role: "assistant",
        content: "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const totalSources = messages.reduce(
    (acc, m) => acc + (m.sources?.length ?? 0),
    0
  );
  const verifiedSources = messages.reduce(
    (acc, m) => acc + (m.sources?.filter((s) => s.verified).length ?? 0),
    0
  );

  return (
    <div className="relative flex flex-col h-full">
      {/* Chromatic atmosphere */}
      <div className="absolute inset-0 pointer-events-none" />
      <div
        className="absolute inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* Header strip (appears once there are messages) */}
      {messages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease }}
          className="relative z-10 border-b border-border bg-white/70 dark:bg-surface/70 backdrop-blur-sm px-6 py-3 flex items-center gap-4"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] uppercase tracking-[0.25em] text-violet">
              ⁂ Research
            </span>
            <span className="font-display text-sm text-foreground">
              Live session
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em]">
            <span className="text-muted">Sources</span>
            <span className="font-bold text-cyan px-1.5 py-0.5 bg-cyan/10 border border-cyan/20">
              {totalSources}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em]">
            <span className="text-muted">Verified</span>
            <span className="font-bold text-green px-1.5 py-0.5 bg-green/10 border border-green/20">
              {verifiedSources}/{totalSources}
            </span>
          </div>
        </motion.div>
      )}

      {/* Messages area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-6 space-y-8">
        <AnimatePresence mode="wait">
          {messages.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease }}
              className="flex flex-col h-full justify-center max-w-3xl mx-auto w-full"
            >
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease, delay: 0.05 }}
                className="text-[10px] uppercase tracking-[0.25em] text-violet mb-4"
              >
                ⁂ Research / Open query
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease, delay: 0.1 }}
                className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95] text-foreground tracking-tight mb-4"
              >
                Ask anything
                <span className="text-violet">.</span>
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease, delay: 0.15 }}
                className="text-sm text-muted max-w-xl leading-relaxed mb-8"
              >
                Forge synthesizes an answer from{" "}
                <span className="text-foreground font-medium">
                  200M+ sources
                </span>{" "}
                and verifies every citation against Crossref — so you never ship
                a false reference.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease, delay: 0.2 }}
              >
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted mb-3">
                  § Starter queries
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-border">
                  {sampleQueries.map((q, idx) => (
                    <motion.button
                      key={q.text}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        ease,
                        delay: 0.3 + idx * 0.06,
                      }}
                      onClick={() => {
                        setInputValue(q.text);
                        inputRef.current?.focus();
                      }}
                      className="group text-left bg-white/70 dark:bg-surface/70 backdrop-blur-sm px-4 py-4 hover:bg-violet/5 border-l-4 border-l-transparent hover:border-l-violet transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white bg-violet px-1.5 py-0.5">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[9px] uppercase tracking-[0.15em] text-warm">
                          {q.tag}
                        </span>
                      </div>
                      <span className="text-xs text-foreground group-hover:text-violet transition-colors leading-snug block">
                        {q.text}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, ease, delay: 0.5 }}
                className="mt-10 flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-muted"
              >
                <Sparkles size={11} className="text-cyan" />
                Powered by Exa · Citations verified against Crossref (150M+
                records)
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map((msg, mIdx) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease, delay: mIdx * 0.02 }}
            className={`max-w-3xl ${
              msg.role === "user" ? "ml-auto" : "mr-auto w-full"
            }`}
          >
            {/* Role label */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-[9px] font-bold uppercase tracking-[0.2em] text-white px-1.5 py-0.5 ${
                  msg.role === "user" ? "bg-muted" : "bg-violet"
                }`}
              >
                {msg.role === "user" ? "You" : "Forge"}
              </span>
              {msg.role === "assistant" && (
                <span className="text-[9px] uppercase tracking-[0.15em] text-warm">
                  AI-synthesized
                </span>
              )}
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Message block */}
            <div
              className={`border border-border ${
                msg.role === "user"
                  ? "bg-violet/[0.06] border-l-4 border-l-violet px-5 py-3"
                  : "bg-white/70 dark:bg-surface/70 backdrop-blur-sm border-l-4 border-l-cyan px-5 py-4"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="text-sm text-foreground/85 leading-[1.85] whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <p className="text-sm text-foreground">{msg.content}</p>
              )}
            </div>

            {/* Source cards */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <BookOpen size={11} className="text-muted" />
                  <span className="text-[9px] uppercase tracking-[0.2em] text-muted">
                    § {msg.sources.length} Sources cited
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white bg-green px-1.5 py-0.5">
                    {msg.sources.filter((s) => s.verified).length}/
                    {msg.sources.length} verified
                  </span>
                </div>
                <div className="space-y-0">
                  {msg.sources.map((source, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.25,
                        ease,
                        delay: 0.06 * idx,
                      }}
                    >
                      <SourceCard source={source} index={idx} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ))}

        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              className="max-w-3xl"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white bg-violet px-1.5 py-0.5">
                  Forge
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex items-center gap-3 bg-cyan/5 border border-cyan/20 border-l-4 border-l-cyan px-5 py-4">
                <Loader2 size={14} className="text-cyan animate-spin" />
                <span className="text-[11px] uppercase tracking-[0.15em] text-cyan font-medium">
                  Synthesizing answer from sources
                </span>
                <span className="flex gap-1 ml-auto">
                  <span className="w-1 h-1 bg-cyan animate-pulse" />
                  <span
                    className="w-1 h-1 bg-cyan animate-pulse"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="w-1 h-1 bg-cyan animate-pulse"
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease, delay: 0.1 }}
        className="relative z-10 bg-white/70 dark:bg-surface/70 backdrop-blur-sm border-t border-border"
      >
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-4 relative"
        >
          <div className="flex items-stretch border border-border bg-background focus-within:border-violet transition-colors">
            <div className="flex items-center px-3 border-r border-border">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-violet">
                Ask
              </span>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask a research question..."
              disabled={loading}
              className="flex-1 bg-transparent text-foreground px-4 py-3 text-sm focus:outline-none placeholder:text-muted disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="flex items-center gap-2 px-4 bg-black dark:bg-white text-white dark:text-black hover:bg-violet dark:hover:bg-violet dark:hover:text-white disabled:opacity-30 transition-colors text-[11px] font-bold uppercase tracking-[0.15em]"
            >
              <Send size={13} />
              Send
            </button>
          </div>
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted mt-2 text-center">
            Exa search · Crossref verification · 150M+ records
          </p>
        </form>
      </motion.div>
    </div>
  );
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const VerifyIcon = source.verifying
    ? ShieldQuestion
    : source.verified === true
      ? ShieldCheck
      : source.verified === false
        ? ShieldAlert
        : ShieldQuestion;

  const verifyColor = source.verifying
    ? "text-muted"
    : source.verified === true
      ? "text-green"
      : source.verified === false
        ? "text-amber"
        : "text-muted";

  const accent =
    source.verified === true
      ? "border-l-green"
      : source.verified === false
        ? "border-l-amber"
        : source.verifying
          ? "border-l-cyan"
          : "border-l-border";

  const verifyLabel = source.verifying
    ? "Verifying"
    : source.verified === true
      ? `DOI · ${source.doi}`
      : source.verified === false
        ? "Not in Crossref"
        : "Pending";

  return (
    <div
      className={`group border border-border border-l-4 ${accent} bg-white/70 dark:bg-surface/70 backdrop-blur-sm px-4 py-3 -mt-px hover:translate-x-1 transition-transform`}
    >
      <div className="flex items-center gap-3">
        <span className="text-[9px] font-bold text-white bg-black dark:bg-white dark:text-black shrink-0 w-6 h-6 flex items-center justify-center">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground hover:text-violet transition-colors font-medium flex items-center gap-1 leading-snug"
          >
            <span className="truncate">{source.title}</span>
            <ExternalLink
              size={10}
              className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
            />
          </a>
          {source.author && (
            <div className="text-[9px] uppercase tracking-[0.15em] text-muted mt-1 truncate">
              {source.author}
            </div>
          )}
        </div>
        <div
          className={`flex items-center gap-1.5 shrink-0 ${verifyColor} text-[9px] uppercase tracking-[0.15em]`}
        >
          <VerifyIcon
            size={11}
            className={source.verifying ? "animate-pulse" : ""}
          />
          <span className="font-medium">{verifyLabel}</span>
        </div>
      </div>
    </div>
  );
}
