"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { useGitLabConfig } from "@/hooks/useGitLabConfig";
import { useAIProvider } from "@/hooks/useAIProvider";
import GitLabSettings from "@/components/GitLabSettings";
import AISettings from "@/components/AISettings";
import { readJSON } from "@/lib/storage/localStore";

const DEFAULT_URL = "https://projetos.irn.justica.gov.pt/";

// Onboarding / configuration page (replaces the old inline login card).
// OpenProject is required; GitLab and AI are optional and reuse the existing
// settings components. On a successful OpenProject validation we persist auth
// and navigate to the app.
export default function SetupPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { config: gitlabConfig, setConfig: setGitlabConfig, clear: clearGitlab } = useGitLabConfig();
  const { config: aiConfig, setConfig: setAIConfig, clear: clearAI } = useAIProvider();

  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [tokenInput, setTokenInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    if (!tokenInput.trim()) {
      setError("Insere um token de API.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const inferenceConfig = readJSON<unknown>("timeline_inference_v1", undefined);
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput, url, inferenceConfig }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao validar o token");
      }
      const data = await response.json();
      localStorage.setItem("openproject_token", tokenInput);
      localStorage.setItem("openproject_url", url);
      localStorage.setItem("openproject_user", JSON.stringify(data.user));
      addToast("Ligado ao OpenProject.", "success");
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticacao com OpenProject");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--surface-2)] dark:bg-slate-950 py-10 px-4">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
            IRN
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Configuracao</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Liga ao OpenProject e, opcionalmente, ao GitLab e a uma IA.</p>
          </div>
        </div>

        {/* OpenProject (obrigatorio) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">OpenProject</h2>
            <span className="rounded-full bg-rose-100 dark:bg-rose-950/40 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">Obrigatorio</span>
          </div>

          <label htmlFor="url" className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
            URL do OpenProject
          </label>
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_URL}
            className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />

          <label htmlFor="token" className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
            API Token
          </label>
          <textarea
            id="token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Cola aqui o teu API token do OpenProject"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 font-mono text-xs"
            rows={3}
          />

          {error && (
            <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
              {error}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={isLoading}
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "A validar..." : "Ligar e entrar"}
          </button>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Para gerar um token, vai ao OpenProject &rarr; perfil &rarr; &quot;Access tokens&quot; &rarr; criar token de API.
          </p>
        </section>

        {/* GitLab (opcional) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">GitLab</h2>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">Opcional</span>
          </div>
          <GitLabSettings config={gitlabConfig} onSave={setGitlabConfig} onClear={clearGitlab} />
        </section>

        {/* IA (opcional) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Assistente IA</h2>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">Opcional</span>
          </div>
          <AISettings config={aiConfig} onSave={setAIConfig} onClear={clearAI} />
        </section>
      </div>
    </main>
  );
}
