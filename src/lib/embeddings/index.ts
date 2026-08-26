import "server-only";

import path from "node:path";

import { env, pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_DIMENSIONS = 768;

const DEFAULT_MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";

export type EmbedKind = "document" | "query";

const TASK_PREFIXES: Record<EmbedKind, string> = {
  document: "search_document: ",
  query: "search_query: ",
};

// Downloaded models are cached in-repo and reused offline on later runs.
// localModelPath points at the cache so every cached file also resolves
// locally when remote access is disabled via HF_HUB_OFFLINE.
const cacheDir = path.join(process.cwd(), ".cache", "huggingface");
env.cacheDir = cacheDir;
env.localModelPath = cacheDir;

const hfOffline = process.env.HF_HUB_OFFLINE ?? "";
if (hfOffline && hfOffline !== "0" && hfOffline !== "false") {
  env.allowRemoteModels = false;
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function modelId(): string {
  return process.env.EMBEDDINGS_MODEL?.trim() || DEFAULT_MODEL_ID;
}

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline("feature-extraction", modelId(), { dtype: "fp32" });
  return extractorPromise;
}

export async function embed(
  text: string,
  kind: EmbedKind = "document",
): Promise<number[]> {
  if (!text.trim()) {
    throw new Error("Cannot embed empty text.");
  }

  const extractor = await getExtractor();
  const output = await extractor(TASK_PREFIXES[kind] + text, {
    pooling: "mean",
    normalize: true,
  });

  const [vector] = output.tolist() as number[][];
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding dimensionality ${vector?.length ?? 0}, expected ${EMBEDDING_DIMENSIONS}.`,
    );
  }
  return vector;
}
