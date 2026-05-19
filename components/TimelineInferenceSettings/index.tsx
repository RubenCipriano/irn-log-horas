"use client";

import { useState } from "react";
import type { TimelineInferenceConfig } from "@/types";

type Props = {
  config: TimelineInferenceConfig;
  setConfig: (c: TimelineInferenceConfig) => void;
  reset: () => void;
};

function ChipList({
  label, hint, values, onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  };
  const remove = (v: string) => onChange(values.filter(x => x !== v));

  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">{label}</label>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">{hint}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300 capitalize">
            {v}
            <button onClick={() => remove(v)} className="text-slate-400 hover:text-rose-500" aria-label={`Remover ${v}`}>×</button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-slate-400">vazio</span>}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="adicionar estado..."
          className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <button
          onClick={add}
          className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-600 transition"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function TimelineInferenceSettings({ config, setConfig, reset }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Inferencia de estados</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Quando o OpenProject salta direto de &quot;Novo&quot; para &quot;Desenvolvido&quot; sem registar o desenvolvimento, o sistema assume um periodo de trabalho ativo no meio. A IA sabe que e uma assumpcao e pergunta o que foi feito.
        </p>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={e => setConfig({ ...config, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Assumir trabalho ativo entre &quot;Novo&quot; e estado terminal</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Inserir segmento &quot;{config.fillState}&quot; nas lacunas.</p>
        </div>
      </label>

      <ChipList
        label="Estados iniciais (starter)"
        hint="Estados de onde se assume que comecou o trabalho."
        values={config.starterStates}
        onChange={v => setConfig({ ...config, starterStates: v })}
      />

      <ChipList
        label="Estados terminais"
        hint="Quando a tarefa chega a um destes, assume-se que houve trabalho ativo no meio."
        values={config.terminalStates}
        onChange={v => setConfig({ ...config, terminalStates: v })}
      />

      <div>
        <label className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">
          Estado a inserir
        </label>
        <input
          type="text"
          value={config.fillState}
          onChange={e => setConfig({ ...config, fillState: e.target.value })}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Nome do estado que sera inserido nas lacunas (ex: &quot;Em Desenvolvimento&quot;).
        </p>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={reset}
          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Repor predefinicoes
        </button>
      </div>
    </div>
  );
}
