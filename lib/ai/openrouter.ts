import type { AIProvider, ChatMessage, ChatOptions } from "./provider";

export function createOpenRouterProvider(apiKey: string, model: string): AIProvider {
  return {
    kind: "openrouter",
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: opts.temperature ?? 0.1,
      };
      if (opts.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "distribute", strict: true, schema: opts.jsonSchema },
        };
      } else if (opts.jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          // OpenRouter-recommended attribution headers
          "HTTP-Referer": "https://github.com/irn/website-log-horas",
          "X-Title": "IRN Log Horas",
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || "";
      if (!content) throw new Error("OpenRouter returned an empty response");
      return content;
    },
  };
}
