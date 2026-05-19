import type { AIProvider, ChatMessage, ChatOptions } from "./provider";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

export function createGeminiProvider(apiKey: string, model: string = DEFAULT_MODEL): AIProvider {
  return {
    kind: "gemini",
    async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
      const systemMessages = messages.filter(m => m.role === "system");
      const conversation = messages.filter(m => m.role !== "system");

      const systemInstruction = systemMessages.length
        ? { parts: systemMessages.map(m => ({ text: m.content })) }
        : undefined;

      const contents = conversation.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const generationConfig: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.1,
      };
      if (opts.jsonMode || opts.jsonSchema) {
        generationConfig.responseMimeType = "application/json";
      }
      if (opts.jsonSchema) {
        // Gemini accepts an OpenAPI-like schema directly under responseSchema.
        generationConfig.responseSchema = opts.jsonSchema;
      }

      const body: Record<string, unknown> = {
        contents,
        generationConfig,
      };
      if (systemInstruction) body.systemInstruction = systemInstruction;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
      if (!text) throw new Error("Gemini returned an empty response");
      return text;
    },
  };
}
