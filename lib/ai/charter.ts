import { readFileSync } from "node:fs";
import { join } from "node:path";

// The charter MD file IS the system prompt. Loaded once at module init from
// docs/ai/charter.md so editing the docs changes AI behaviour with no code
// change required. Server-only — never imported from client bundles.

let cached: string | null = null;

export function getCharterSystemPrompt(): string {
  if (cached !== null) return cached;
  const charterPath = join(process.cwd(), "docs", "ai", "charter.md");
  try {
    cached = readFileSync(charterPath, "utf8");
  } catch {
    // Last-resort fallback so a missing/renamed charter never silently
    // strips the system prompt entirely. Log (no secrets) so a bad serverless
    // bundle that drops docs/ai/charter.md is visible instead of silent.
    console.warn(`[charter] could not read ${charterPath} — using built-in fallback prompt.`);
    cached = "Es um assistente que ajuda a registar horas e gerir estados de tarefas no OpenProject IRN. Nunca executas, so propoes. Devolves SO JSON {\"reasoning\":\"...\",\"actions\":[...]}.";
  }
  return cached;
}

// Minimal prompt used by the understand-first safety mode. Asks the model to
// paraphrase the user intent in 1-2 sentences. NO actions are emitted from
// this call — only an {"interpretation": "..."} object.
export function getUnderstandFirstPrompt(): string {
  return `Es um assistente IA que regista horas e altera estados no OpenProject IRN. Antes de propor um plano, parafraseia o que o utilizador pediu para confirmares que percebeste.

Devolves SO este JSON: {"interpretation": "..."} onde interpretation tem 1-2 frases em portugues europeu a descrever o que vais fazer. NAO propoes accoes nesta chamada — esperas pela aprovacao do utilizador.`;
}
