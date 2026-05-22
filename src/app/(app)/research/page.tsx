"use client";

/**
 * Research — multi-turn chat surface.
 *
 * Replaces the previous single-shot ResearchPanel with a real chat
 * thread: project-scoped, persisted to Firestore, context-aware.
 * The page header stays calm (eyebrow + title + subtitle) and the
 * chat region owns the remaining viewport.
 */

import { motion } from "framer-motion";
import { useMemo, useRef } from "react";
import { ChatThread, type ChatThreadHandle } from "@/components/research/ChatThread";
import { useChatThread } from "@/hooks/useChatThread";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useProjectsStore } from "@/store/projects";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function ResearchPage() {
  const { projectId } = useActiveProject();
  const projects = useProjectsStore((s) => s.projects);
  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? null,
    [projects, projectId],
  );

  const thread = useChatThread({
    projectId,
    projectName,
  });

  const threadRef = useRef<ChatThreadHandle | null>(null);

  return (
    <div className="min-h-full flex flex-col bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-4 sm:px-10 pt-8 sm:pt-10 pb-6"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
          Chat
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          Ask anything.
        </h1>
        <p className="text-[14px] text-muted mt-2 max-w-xl leading-relaxed">
          Forge keeps the conversation context across every turn. Ask
          follow-ups, dig deeper, and save what you want back into your
          project.
        </p>
      </motion.header>

      <ChatThread
        ref={threadRef}
        messages={thread.messages}
        sending={thread.sending}
        loading={thread.loading}
        error={thread.error}
        onSend={thread.send}
        onReset={thread.reset}
        projectName={projectName}
      />
    </div>
  );
}
