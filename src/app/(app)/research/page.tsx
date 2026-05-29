"use client";

/**
 * Research — multi-turn chat surface.
 *
 * Replaces the previous single-shot ResearchPanel with a real chat
 * thread: persisted to Firestore, context-aware, and usable with or
 * without an active project.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChatThread, type ChatThreadHandle } from "@/components/research/ChatThread";
import { useChatThread } from "@/hooks/useChatThread";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useProjectsStore } from "@/store/projects";
import { GROQ_MODELS, type AiMode, type AiModelOption } from "@/lib/ai/models";

export default function ResearchPage() {
  const { projectId } = useActiveProject();
  const projects = useProjectsStore((s) => s.projects);
  const projectName = useMemo(
    () => projects.find((p) => p.id === projectId)?.name ?? null,
    [projects, projectId],
  );

  // `?c=<conversationId>` jumps straight back into a thread —
  // used by the sidebar's "Recent chats" buttons.
  const search = useSearchParams();
  const initialConversationId = search?.get("c") ?? null;
  // `?ask=<text>` seeds the composer (used by the ⌘K "Ask Forge" row).
  const askParam = search?.get("ask") ?? null;
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>(GROQ_MODELS);
  const [selectedModelId, setSelectedModelId] = useState("llama-3.3-70b-versatile");
  const [aiMode, setAiMode] = useState<AiMode>("standard");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { models?: AiModelOption[] }) => {
        if (cancelled || !Array.isArray(data.models) || data.models.length === 0) return;
        setModelOptions(data.models);
        setSelectedModelId((current) =>
          data.models!.some((m) => m.id === current) ? current : data.models![0].id,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = useMemo(
    () => modelOptions.find((m) => m.id === selectedModelId) ?? modelOptions[0],
    [modelOptions, selectedModelId],
  );

  const effectiveAiMode = selectedModel?.modes.includes(aiMode)
    ? aiMode
    : selectedModel?.defaultMode ?? "standard";

  const thread = useChatThread({
    projectId,
    projectName,
    initialConversationId,
    modelId: selectedModelId,
    aiMode: effectiveAiMode,
  });

  const threadRef = useRef<ChatThreadHandle | null>(null);

  // Seed the composer from `?ask=` exactly once per distinct value.
  const seededAskRef = useRef<string | null>(null);
  useEffect(() => {
    const q = askParam?.trim();
    if (!q || seededAskRef.current === q) return;
    seededAskRef.current = q;
    requestAnimationFrame(() => threadRef.current?.prefill(q));
  }, [askParam]);

  return (
    <div className="min-h-full flex flex-col bg-background">
      <ChatThread
        ref={threadRef}
        messages={thread.messages}
        sending={thread.sending}
        loading={thread.loading}
        error={thread.error}
        onSend={thread.send}
        onReset={thread.reset}
        projectName={projectName}
        modelOptions={modelOptions}
        selectedModelId={selectedModelId}
        aiMode={effectiveAiMode}
        onModelChange={(modelId) => {
          setSelectedModelId(modelId);
          const nextModel = modelOptions.find((m) => m.id === modelId);
          if (nextModel && !nextModel.modes.includes(aiMode)) {
            setAiMode(nextModel.defaultMode);
          }
        }}
        onAiModeChange={setAiMode}
      />
    </div>
  );
}
