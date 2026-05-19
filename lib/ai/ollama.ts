import type { AIProvider, ChatMessage, ChatOptions } from "./provider";

export function createOllamaProvider(baseUrl: string, model: string): AIProvider {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return {
    kind: "ollama",
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.1 },
      };
      if (opts.jsonMode || opts.jsonSchema) body.format = "json";

      const response = await fetch(`${normalizedBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data?.message?.content || "";
      if (!content) throw new Error("Ollama returned an empty response");
      return content;
    },
  };
}
