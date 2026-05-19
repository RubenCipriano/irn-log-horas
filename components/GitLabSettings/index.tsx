"use client";

import { useState } from "react";
import type { GitLabConfig } from "@/types";
import { useToast } from "@/components/Toast";

type Props = {
  config: GitLabConfig | null;
  onSave: (config: GitLabConfig) => void;
  onClear: () => void;
};

export default function GitLabSettings({ config, onSave, onClear }: Props) {
  const { addToast } = useToast();
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || "");
  const [accessToken, setAccessToken] = useState(config?.accessToken || "");
  const [testing, setTesting] = useState(false);

  const handleSave = () => {
    if (!baseUrl.trim() || !accessToken.trim()) {
      addToast("Preenche URL e token.", "warning");
      return;
    }
    onSave({ baseUrl: baseUrl.trim(), accessToken: accessToken.trim() });
    addToast("GitLab configurado.", "success");
  };

  const handleTest = async () => {
    if (!baseUrl.trim() || !accessToken.trim()) {
      addToast("Preenche os campos antes de testar.", "warning");
      return;
    }
    setTesting(true);
    try {
      const response = await fetch("/api/gitlab/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { baseUrl: baseUrl.trim(), accessToken: accessToken.trim() },
          testOnly: true,
        }),
      });
      const data = await response.json();
      if (response.ok && data.user) {
        addToast(`Ligado como ${data.user.username}.`, "success");
        onSave({ baseUrl: baseUrl.trim(), accessToken: accessToken.trim(), username: data.user.username });
      } else {
        addToast(`Erro: ${data.error || response.statusText}`, "error");
      }
    } catch (err) {
      addToast(`Erro: ${err instanceof Error ? err.message : "rede"}`, "error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Integracao GitLab</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Permite a IA usar os teus commits e MRs recentes para sugerir horas. O token fica apenas no teu browser.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
          URL do GitLab
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://gitlab.justica.gov.pt"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
          Personal Access Token
        </label>
        <input
          type="password"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder="glpat-..."
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Cria em Settings → Access Tokens com scopes <code className="font-mono text-[10px]">read_api</code> e <code className="font-mono text-[10px]">read_user</code>.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-600 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Como referenciar tarefas nos commits</p>
        <p>Inclui o numero da tarefa no titulo do commit ou no nome da branch (ex: <code className="font-mono text-[10px]">#32195</code>, <code className="font-mono text-[10px]">wp-32195</code>, ou simplesmente <code className="font-mono text-[10px]">32195</code>). A IA vai associar essas alteracoes a essa tarefa.</p>
      </div>

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
