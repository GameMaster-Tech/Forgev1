/**
 * VoyageEmbedder — production text embedder for Veritas memory.
 *
 * Voyage AI is the embedding stack Anthropic recommends for RAG; `voyage-3`
 * trades a small precision dip for ~3× cost reduction vs `voyage-large-2`,
 * which fits Forge's per-claim cost target (we embed every claim on write).
 *
 * Wire shape: `POST https://api.voyageai.com/v1/embeddings` with a list of
 * input texts; response has `data[].embedding: number[]`. Vectors are L2-
 * normalised here regardless of server behaviour so `cosine()` == dot product.
 *
 * Why HTTP via fetch and not the official SDK?
 *   • Zero extra deps — Voyage's TS SDK pulls a sizeable transitive tree.
 *   • Same fetch-injection pattern as the bench-runner, so tests can stub
 *     responses without monkey-patching globals.
 */

import { BaseEmbedder, type Embedding, l2Normalise } from "./embedder";

export interface VoyageEmbedderOptions {
  apiKey?: string;
  /** Default `voyage-3`. Change to `voyage-3-large` for higher precision. */
  model?: string;
  /** Endpoint override — useful for proxies. Defaults to api.voyageai.com. */
  baseUrl?: string;
  /** Test-time fetch injection. */
  fetchImpl?: typeof fetch;
  /** Request timeout, ms. Default 30s. */
  timeoutMs?: number;
}

const VOYAGE_DEFAULT_DIM: Record<string, number> = {
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-3-large": 1024,
  "voyage-large-2": 1536,
};

export class VoyageEmbedder extends BaseEmbedder {
  readonly modelId: string;
  readonly dim: number;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: VoyageEmbedderOptions = {}) {
    super();
    this.modelId = opts.model ?? "voyage-3";
    this.dim = VOYAGE_DEFAULT_DIM[this.modelId] ?? 1024;
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.voyageai.com/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async embed(text: string): Promise<Embedding> {
    const [first] = await this.embedBatch([text]);
    return first;
  }

  override async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (!this.apiKey) {
      throw new Error(
        "VoyageEmbedder: VOYAGE_API_KEY not configured — set it before calling embed().",
      );
    }
    if (texts.length === 0) return [];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.modelId,
          // `document` is the type to use for stored corpus; `query` is
          // the symmetric variant. Veritas claims are stored docs.
          input_type: "document",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await safeText(res);
        throw new Error(
          `VoyageEmbedder: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
      const json = (await res.json()) as VoyageResponse;
      if (!Array.isArray(json.data) || json.data.length !== texts.length) {
        throw new Error(
          `VoyageEmbedder: response length mismatch (sent=${texts.length} got=${json.data?.length ?? 0})`,
        );
      }
      return json.data
        .sort((a, b) => a.index - b.index)
        .map((row) => {
          const v = Array.from(row.embedding);
          l2Normalise(v);
          return { vector: v, dim: v.length, modelId: this.modelId };
        });
    } finally {
      clearTimeout(timer);
    }
  }
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}
