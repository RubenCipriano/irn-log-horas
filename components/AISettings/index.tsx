"use client";

import { useState } from "react";
import type { AIProviderConfig } from "@/types";
import { useToast } from "@/components/Toast";

type Props = {
  config: AIProviderConfig | null;
  onSave: (config: AIProviderConfig) => void;
  onClear: () => void;
};

type Kind = AIProviderConfig["kind"];

const PROVIDER_INFO: Record<Kind, { label: string; description: string; help: string }> = {
  gemini: {
    label: "Google Gemini",
    description: "Free tier ~1000 req/dia. Modelo: gemini-2.5-flash-lite",
    help: "Cria uma API key em ai.google.dev (gratuita).",
  },
  groq: {
    label: "Groq",
    description: "Free, latencia ~200 ms. Modelo: llama-3.3-70b-versatile",
    help: "Cria uma API key em console.groq.com (gratuita).",
  },
  anthropic: {
    label: "Anthropic Claude",
    description: "Modelos Claude directos (Haiku, Sonnet, Opus). Pago. Sugestao: claude-3-5-haiku-latest (rapido) ou claude-3-5-sonnet-latest (melhor qualidade).",
    help: "Cria uma API key em console.anthropic.com. Precisa de creditos / plano.",
  },
  openrouter: {
    label: "OpenRouter",
    description: "Centenas de modelos (free e pagos). Sugestoes: meta-llama/llama-3.3-70b-instruct:free, google/gemini-flash-1.5:free, anthropic/claude-3.5-sonnet",
    help: "Cria conta em openrouter.ai e gera uma API key.",
  },
  ollama: {
    label: "Ollama (local)",
    description: "100% local, sem custo. Necessita Ollama instalado.",
    help: "Instala em ollama.com e corre `ollama pull qwen2.5:7b`.",
  },
  "openai-compat": {
    label: "OpenAI-compativel",
    description: "Qualquer endpoint compativel (LM Studio, vLLM, FastChat, DeepInfra, Together, Mistral, etc.).",
    help: "URL base do servidor (ex. https://api.together.xyz/v1) + modelo. API key opcional.",
  },
};

const DEFAULT_MODELS: Record<Kind, string> = {
  gemini: "gemini-2.5-flash-lite",
  groq: "llama-3.3-70b-versatile",
  anthropic: "claude-3-5-haiku-latest",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  ollama: "qwen2.5:7b",
  "openai-compat": "",
};

export default function AISettings({ config, onSave, onClear }: Props) {
  const { addToast } = useToast();
  const [kind, setKind] = useState<Kind>(config?.kind || "gemini");
  const [apiKey, setApiKey] = useState(
    config && config.kind !== "ollama" && (config as { apiKey?: string }).apiKey
      ? (config as { apiKey?: string }).apiKey || ""
      : ""
  );
  const [model, setModel] = useState(() => {
    if (config) {
      const m = (config as { model?: string }).model;
      if (m) return m;
    }
    return DEFAULT_MODELS[kind];
  });
  const [baseUrl, setBaseUrl] = useState(
    config?.kind === "ollama"
      ? config.baseUrl
      : config?.kind === "openai-compat"
        ? config.baseUrl
        : kind === "ollama" ? "http://localhost:11434" : ""
  );
  const [testing, setTesting] = useState(false);

  // When the user picks a different kind, reset the model + base url to a sensible default
  const handlePickKind = (next: Kind) => {
    setKind(next);
    setModel(DEFAULT_MODELS[next]);
    if (next === "ollama") setBaseUrl("http://localhost:11434");
    else if (next !== "openai-compat") setBaseUrl("");
  };

  const buildConfig = (): AIProviderConfig | null => {
    if (kind === "ollama") {
      if (!baseUrl.trim() || !model.trim()) return null;
      return { kind: "ollama", baseUrl: baseUrl.trim(), model: model.trim() };
    }
    if (kind === "openai-compat") {
      if (!baseUrl.trim() || !model.trim()) return null;
      const out: AIProviderConfig = { kind: "openai-compat", baseUrl: baseUrl.trim(), model: model.trim() };
      if (apiKey.trim()) (out as { apiKey?: string }).apiKey = apiKey.trim();
      return out;
    }
    if (kind === "openrouter") {
      if (!apiKey.trim() || !model.trim()) return null;
      return { kind: "openrouter", apiKey: apiKey.trim(), model: model.trim() };
    }
    if (!apiKey.trim()) return null;
    return { kind, apiKey: apiKey.trim(), model: model.trim() || undefined };
  };

  const handleSave = () => {
    const next = buildConfig();
    if (!next) {
      addToast("Preenche os campos obrigatorios.", "warning");
      return;
    }
    onSave(next);
    addToast(`Fornecedor ${PROVIDER_INFO[kind].label} guardado.`, "success");
  };

  const handleTest = async () => {
    const next = buildConfig();
    if (!next) {
      addToast("Preenche os campos antes de testar.", "warning");
      return;
    }
    setTesting(true);
    try {
      const response = await fetch("/api/ai/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "ping",
          dateRange: { from: "2026-01-01", to: "2026-01-01" },
          tasks: [],
          weights: {},
          schedule: { summer: { monThu: 7, fri: 9 }, winter: { monThu: 9, fri: 7 }, summerMonths: [3, 9] },
          providerConfig: next,
        }),
      });
      if (response.ok) {
        addToast("Ligacao OK!", "success");
      } else {
        const data = await response.json().catch(() => ({}));
        addToast(`Erro: ${data.error || response.statusText}`, "error");
      }
    } catch (err) {
      addToast(`Erro: ${err instanceof Error ? err.message : "rede"}`, "error");
    } finally {
      setTesting(false);
    }
  };

  const showApiKey = kind !== "ollama";
  const apiKeyRequired = kind === "gemini" || kind === "groq" || kind === "openrouter";
  const showBaseUrl = kind === "ollama" || kind === "openai-compat";
  const showModel = true;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Fornecedor de IA</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          A chave nunca e guardada no servidor — fica apenas no teu browser e e enviada por pedido.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(PROVIDER_INFO) as Kind[]).map(k => (
          <button
            key={k}
            onClick={() => handlePickKind(k)}
            className={`rounded-lg border p-2.5 text-left text-xs transition ${
              kind === k
                ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
          >
            <p className="font-semibold text-slate-900 dark:text-slate-100">{PROVIDER_INFO[k].label}</p>
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">{PROVIDER_INFO[kind].description}</p>

      {showBaseUrl && (
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
            URL base
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={kind === "ollama" ? "http://localhost:11434" : "https://api.together.xyz/v1"}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {showApiKey && (
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
            API Key {!apiKeyRequired && <span className="text-slate-400 normal-case font-normal">(opcional)</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={apiKeyRequired ? "Cola aqui a tua API key" : "Cola aqui se o endpoint pedir auth"}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      {showModel && (
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
            Modelo
          </label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={DEFAULT_MODELS[kind] || "ex. meta-llama/llama-3.3-70b-instruct"}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">{PROVIDER_INFO[kind].help}</p>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
        >
          Guardar
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
        >
          {testing ? "A testar..." : "Testar ligacao"}
        </button>
        {config && (
          <button
            onClick={onClear}
            className="rounded-lg border border-rose-200 dark:border-rose-800 px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
          >
            Remover
          </button>
        )}
      </div>
    </div>
  );
}
