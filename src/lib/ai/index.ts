import "server-only";

import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";

type ProviderId = "groq" | "google";

const PROVIDERS: Record<
  ProviderId,
  {
    defaultModel: string;
    apiKeyEnv: string;
    create: (apiKey: string, modelId: string) => LanguageModel;
  }
> = {
  groq: {
    defaultModel: "openai/gpt-oss-120b",
    apiKeyEnv: "GROQ_API_KEY",
    create: (apiKey, modelId) => createGroq({ apiKey })(modelId),
  },
  google: {
    defaultModel: "gemini-3.6-flash",
    apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    create: (apiKey, modelId) => createGoogle({ apiKey })(modelId),
  },
};

function resolveProvider(): ProviderId {
  const id = (process.env.AI_PROVIDER?.trim().toLowerCase() || "groq") as ProviderId;
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(
      `Unsupported AI_PROVIDER "${id}". Supported providers: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return id;
}

export function getModel(): LanguageModel {
  const id = resolveProvider();
  const provider = PROVIDERS[id];

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key for AI_PROVIDER "${id}". Set ${provider.apiKeyEnv} in your environment.`,
    );
  }

  return provider.create(apiKey, process.env.AI_MODEL?.trim() || provider.defaultModel);
}
