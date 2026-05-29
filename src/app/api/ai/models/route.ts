import { NextResponse } from "next/server";
import { filterAvailableGroqModels } from "@/lib/ai/models";

export const runtime = "nodejs";

const MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";

interface GroqModelsResponse {
  data?: Array<{ id?: string }>;
}

export async function GET() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({
      provider: "groq",
      configured: false,
      models: filterAvailableGroqModels([]),
      warning: "GROQ_API_KEY is not configured.",
    });
  }

  try {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        provider: "groq",
        configured: true,
        models: filterAvailableGroqModels([]),
        warning: `Groq model discovery failed (${res.status}). Using known Forge-compatible models.`,
      });
    }
    const data = (await res.json()) as GroqModelsResponse;
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    return NextResponse.json({
      provider: "groq",
      configured: true,
      models: filterAvailableGroqModels(ids),
    });
  } catch (err) {
    return NextResponse.json({
      provider: "groq",
      configured: true,
      models: filterAvailableGroqModels([]),
      warning: classifyModelDiscoveryError(err),
    });
  }
}

function classifyModelDiscoveryError(err: unknown): string {
  const cause = err instanceof Error ? (err as Error & { cause?: { code?: string } }).cause : null;
  if (cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "Node cannot verify Groq's TLS certificate. Run Next with NODE_OPTIONS=--use-system-ca.";
  }
  return "Groq model discovery failed. Using known Forge-compatible models.";
}
