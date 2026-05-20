import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/factory";
import { buildUnderstandFirstPrompt, parseUnderstandFirstResponse } from "@/lib/ai/prompt";

// Safety-mode endpoint (Phase 12). Single short call: the model paraphrases
// the user's intent. No actions. The browser shows it and asks the user to
// approve before firing the full plan call.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, providerConfig } = body;
    if (typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "Missing description" }, { status: 400 });
    }
    if (!providerConfig?.kind) {
      return NextResponse.json({ error: "Missing AI provider configuration" }, { status: 400 });
    }

    const provider = getProvider(providerConfig);
    const messages = buildUnderstandFirstPrompt(description);
    const raw = await provider.chat(messages, { jsonMode: true, temperature: 0.1, signal: request.signal });
    const parsed = parseUnderstandFirstResponse(raw);

    return NextResponse.json({
      interpretation: parsed.interpretation || "",
      warnings: parsed.warnings,
      rawResponse: raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call AI provider";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
