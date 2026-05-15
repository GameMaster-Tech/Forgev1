/**
 * Embeddings — barrel.
 *
 * Production default: VoyageEmbedder (`voyage-3`).
 * Dev / test default: HashEmbedder — deterministic, no network, no key.
 *
 * Pick at adapter wire-up time:
 *
 *   const embedder = process.env.VOYAGE_API_KEY
 *     ? new VoyageEmbedder({ apiKey: process.env.VOYAGE_API_KEY })
 *     : new HashEmbedder();
 */

export {
  type Embedder,
  type Embedding,
  BaseEmbedder,
  HashEmbedder,
  l2Normalise,
  cosine,
} from "./embedder";

export {
  VoyageEmbedder,
  type VoyageEmbedderOptions,
} from "./voyage-embedder";
