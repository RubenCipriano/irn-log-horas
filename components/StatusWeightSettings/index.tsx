"use client";

import { useMemo } from "react";
import type { StatusWeightConfig, TaskStatusTimeline } from "@/types";
import { DEFAULT_STATUS_WEIGHTS, collectDetectedStatuses } from "@/lib/status-timeline";

type Props = {
  timelines: Record<string, TaskStatusTimeline>;
  weights: StatusWeightConfig;
  overrides: StatusWeightConfig;
  setWeight: (statusLower: string, value: number) => void;
  resetWeight: (statusLower: string) => void;
  reset: () => void;
};

function weightColor(w: number): string {
  if (w >= 0.7) return "bg-emerald-500";
  if (w >= 0.4) return "bg-amber-500";
  if (w > 0) return "bg-orange-500";
  return "bg-slate-300 dark:bg-slate-600";
}

function weightLabel(w: number): string {
  if (w >= 0.8) return "Trabalho ativo";
  if (w >= 0.4) return "Revisao / QA";
  if (w > 0) return "Toque ligeiro";
  return "Excluido";
}

export default function StatusWeightSettings({
  timelines,
  weights,
  overrides,
  setWeight,
  resetWeight,
  reset,
}: Props) {
  const detected = useMemo(() => collectDetectedStatuses(timelines), [timelines]);

  // Show defaults too, so the user can tune statuses that haven't appeared in their data yet
  const allKeys = useMemo(() => {
    const set = new Set<string>([...detected, ...Object.keys(DEFAULT_STATUS_WEIGHTS)]);
    return Array.from(set).sort();
  }, [detected]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Pesos por estado</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Define quantas horas cada estado deve receber (0 = excluido, 1 = trabalho total).
          </p>
        </div>
        {Object.keys(overrides).length > 0 && (
          <button
            onClick={reset}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
          >
            Repor todos
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {allKeys.map(key => {
          const value = weights[key] ?? 0.5;
          const isOverride = key in overrides;
          const isDetected = detected.includes(key);
          return (
            <div
              key={key}
              className={`rounded-lg border p-2.5 ${
                isDetected
                  ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  : "border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${weightColor(value)}`} />
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate capitalize">
                    {key}
                  </span>
                  {!isDetected && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">predefinido</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{weightLabel(value)}</span>
                  <span className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-300 w-8 text-right">
                    {value.toFixed(1)}
                  </span>
                  {isOverride && (
                    <button
                      onClick={() => resetWeight(key)}
                      className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="Repor predefinicao"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={value}
                onChange={(e) => setWeight(key, parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 cursor-pointer accent-indigo-500"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
