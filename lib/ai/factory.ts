import type { AIProviderConfig } from "@/types";
import type { AIProvider } from "./provider";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import { createOllamaProvider } from "./ollama";
import { createOpenRouterProvider } from "./openrouter";
import { createOpenAICompatProvider } from "./openai-compat";
import { createAnthropicProvider } from "./anthropic";

export function getProvider(cfg: AIProviderConfig): AIProvider {
  switch (cfg.kind) {
    case "gemini":
      return createGeminiProvider(cfg.apiKey, cfg.model);
    case "groq":
      return createGroqProvider(cfg.apiKey, cfg.model);
    case "ollama":
      return createOllamaProvider(cfg.baseUrl, cfg.model);
    case "openrouter":
      return createOpenRouterProvider(cfg.apiKey, cfg.model);
    case "openai-compat":
      return createOpenAICompatProvider({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        extraHeaders: cfg.headers,
      });
    case "anthropic":
      return createAnthropicProvider(cfg.apiKey, cfg.model);
    default: {
      const _exhaustive: never = cfg;
      throw new Error(`Unknown AI provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
