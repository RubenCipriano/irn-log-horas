import type { AIProvider, ChatMessage, ChatOptions } from "./provider";

export type OpenAICompatOptions = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  extraHeaders?: Record<string, string>;
};

// Generic adapter for any OpenAI-compatible /chat/completions endpoint
// (LM Studio, vLLM, FastChat, llama-cpp-python server, Together, DeepInfra,
// Together AI, Mistral La Plateforme, etc.).
export function createOpenAICompatProvider(opts: OpenAICompatOptions): AIProvider {
  const normalizedBase = opts.baseUrl.replace(/\/$/, "");
  // If user provided the full URL (...chat/completions), use it as-is.
  const url = normalizedBase.endsWith("/chat/completions")
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;

  return {
    kind: "openai-compat",
    async chat(messages: ChatMessage[], chatOpts: ChatOptions = {}): Promise<string> {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        temperature: chatOpts.temperature ?? 0.1,
      };
      if (chatOpts.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "distribute", strict: true, schema: chatOpts.jsonSchema },
        };
      } else if (chatOpts.jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(opts.extraHeaders || {}),
      };
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: chatOpts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI-compatible endpoint error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      if (!content) throw new Error("OpenAI-compatible endpoint returned an empty response");
      return content;
    },
  };
}
