import type { AIProvider, ChatMessage, ChatOptions } from "./provider";

const DEFAULT_MODEL = "claude-3-5-haiku-latest";
const API_VERSION = "2023-06-01";

// Anthropic Messages API differs from OpenAI in two notable ways:
// 1. The system prompt is a top-level field, not a message with role "system".
// 2. Auth uses x-api-key (not Bearer) and requires an anthropic-version header.
export function createAnthropicProvider(apiKey: string, model: string = DEFAULT_MODEL): AIProvider {
  return {
    kind: "anthropic",
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
      const systemParts = messages.filter(m => m.role === "system").map(m => m.content);
      const system = systemParts.join("\n\n") || undefined;

      const convo = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

      // JSON-prefill trick: when callers want structured JSON output, append an
      // assistant turn opening with "{" so Claude continues with a JSON object.
      const wantsJson = Boolean(opts.jsonMode || opts.jsonSchema);
      // Only prefill when the last turn in the convo is from the user — otherwise
      // we'd append two assistant turns in a row (the retry path already adds one).
      const lastTurn = convo[convo.length - 1];
      const shouldPrefill = wantsJson && lastTurn?.role === "user";
      if (shouldPrefill) convo.push({ role: "assistant", content: "{" });

      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        temperature: opts.temperature ?? 0.1,
        messages: convo,
      };
      if (system) body.system = system;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const parts = Array.isArray(data?.content) ? data.content : [];
      let text = parts
        .filter((p: { type?: string }) => p.type === "text")
        .map((p: { text?: string }) => p.text || "")
        .join("");
      // Re-attach the prefilled "{" so the parser receives the complete JSON.
      if (shouldPrefill) text = "{" + text;
      if (!text) throw new Error("Anthropic returned an empty response");
      return text;
    },
  };
}
