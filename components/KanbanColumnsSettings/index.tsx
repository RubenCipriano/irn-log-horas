"use client";

import { useMemo } from "react";
import type { AvailableStatus } from "@/types";
import type { KanbanColumnConfig } from "@/hooks/useKanbanColumns";

type Props = {
  availableStatuses: AvailableStatus[];
  config: KanbanColumnConfig[];
  toggleVisible: (statusId: string) => void;
  moveColumn: (statusId: string, direction: "up" | "down") => void;
  reset: () => void;
};

export default function KanbanColumnsSettings({ availableStatuses, config, toggleVisible, moveColumn, reset }: Props) {
  // Render in stored order; any status not in config (newly fetched) is still
  // shown at the end via the merged list provided by the parent through `config`.
  const rows = useMemo(() => {
    return config
      .map(c => ({ c, status: availableStatuses.find(s => s.id === c.statusId) }))
      .filter((r): r is { c: KanbanColumnConfig; status: AvailableStatus } => Boolean(r.status));
  }, [config, availableStatuses]);

  if (availableStatuses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-4 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Sem estados disponiveis. Recarrega a sessao para os obter do OpenProject.
        </p>
      </div>
    );
  }

  const visibleCount = rows.filter(r => r.c.visible).length;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Colunas do Kanban</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Escolhe quais os estados aparecem como colunas e a sua ordem. Estados desligados juntam-se na coluna <strong>Outros</strong>.
        </p>
      </div>

      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {visibleCount} de {rows.length} estados visiveis
      </div>

      <ul className="space-y-1">
        {rows.map((row, i) => (
          <li
            key={row.c.statusId}
            className={`flex items-center gap-2 rounded-lg border p-2 transition ${
              row.c.visible
                ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                : "border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 opacity-60"
            }`}
          >
            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
              <input
                type="checkbox"
                checked={row.c.visible}
                onChange={() => toggleVisible(row.c.statusId)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-slate-900 dark:text-slate-100 truncate">
                {row.status.name}
              </span>
              {row.status.isClosed && (
                <span className="text-[9px] uppercase font-semibold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded">
                  terminal
                </span>
              )}
            </label>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => moveColumn(row.c.statusId, "up")}
                disabled={i === 0}
                title="Mover para cima"
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                onClick={() => moveColumn(row.c.statusId, "down")}
                disabled={i === rows.length - 1}
                title="Mover para baixo"
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={reset}
        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Repor predefinicoes
      </button>
    </div>
  );
}
