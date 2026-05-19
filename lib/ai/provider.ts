import type { AIProviderConfig } from "@/types";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  temperature?: number;
  jsonMode?: boolean;
  // JSON schema describing expected output. Providers that support strict
  // structured output use it directly; others fall back to jsonMode.
  jsonSchema?: object;
  // Abort signal forwarded to the underlying fetch.
  signal?: AbortSignal;
};

export interface AIProvider {
  readonly kind: AIProviderConfig["kind"];
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}
