export type AiMode = "standard" | "thinking" | "reasoning";

export interface AiModelOption {
  id: string;
  label: string;
  provider: "groq";
  defaultMode: AiMode;
  modes: AiMode[];
  latency: "fast" | "balanced" | "deep";
  maxCompletionTokens: number;
}

export interface GroqModeConfig {
  model: string;
  mode: AiMode;
  maxCompletionTokens: number;
  reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
  reasoningFormat?: "hidden" | "parsed";
}

export const GROQ_MODELS: AiModelOption[] = [
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B",
    provider: "groq",
    defaultMode: "standard",
    modes: ["standard"],
    latency: "fast",
    maxCompletionTokens: 1200,
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    defaultMode: "standard",
    modes: ["standard"],
    latency: "balanced",
    maxCompletionTokens: 2000,
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen 3 32B",
    provider: "groq",
    defaultMode: "thinking",
    modes: ["standard", "thinking"],
    latency: "balanced",
    maxCompletionTokens: 2400,
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    defaultMode: "reasoning",
    modes: ["thinking", "reasoning"],
    latency: "deep",
    maxCompletionTokens: 3200,
  },
];

const FALLBACK_MODEL = "llama-3.3-70b-versatile";

export function getKnownGroqModel(id: string | null | undefined): AiModelOption | null {
  if (!id) return null;
  return GROQ_MODELS.find((m) => m.id === id) ?? null;
}

export function filterAvailableGroqModels(availableIds: string[]): AiModelOption[] {
  const available = new Set(availableIds);
  const models = GROQ_MODELS.filter((m) => available.has(m.id));
  return models.length > 0 ? models : GROQ_MODELS;
}

export function resolveGroqModeConfig(args: {
  model?: string | null;
  mode?: string | null;
  maxCompletionTokens?: number;
}): GroqModeConfig {
  const requestedModel = args.model?.trim() || process.env.GROQ_MODEL || FALLBACK_MODEL;
  const model = getKnownGroqModel(requestedModel) ?? getKnownGroqModel(FALLBACK_MODEL)!;
  const requestedMode = parseAiMode(args.mode) ?? model.defaultMode;
  const mode = model.modes.includes(requestedMode) ? requestedMode : model.defaultMode;
  const maxCompletionTokens = Math.min(
    args.maxCompletionTokens ?? model.maxCompletionTokens,
    model.maxCompletionTokens,
  );

  if (model.id === "qwen/qwen3-32b") {
    return {
      model: model.id,
      mode,
      maxCompletionTokens,
      reasoningEffort: mode === "standard" ? "none" : "default",
      reasoningFormat: "hidden",
    };
  }

  if (model.id.startsWith("openai/gpt-oss")) {
    return {
      model: model.id,
      mode,
      maxCompletionTokens,
      reasoningEffort: mode === "reasoning" ? "high" : "medium",
      reasoningFormat: "hidden",
    };
  }

  return { model: model.id, mode: "standard", maxCompletionTokens };
}

export function parseAiMode(value: string | null | undefined): AiMode | null {
  return value === "standard" || value === "thinking" || value === "reasoning"
    ? value
    : null;
}

export function modeLabel(mode: AiMode): string {
  if (mode === "standard") return "Standard";
  if (mode === "thinking") return "Thinking";
  return "Reasoning";
}
