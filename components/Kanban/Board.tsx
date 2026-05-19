"use client";

import { useMemo, useState } from "react";
import type { TodoItem, StatusWeightConfig, AvailableStatus } from "@/types";
import type { KanbanColumnConfig } from "@/hooks/useKanbanColumns";
import { useToast } from "@/components/Toast";
import KanbanColumn from "./Column";
import KanbanCard from "./Card";

type Props = {
  tasks: TodoItem[];
  availableStatuses: AvailableStatus[];
  columns: KanbanColumnConfig[];
  weights: StatusWeightConfig;
  authToken?: string | null;
  authUrl?: string;
  gitlabTaskIds?: Set<string>;
  onTaskClick: (todo: TodoItem) => void;
  onStatusChanged: (taskId: string, result: { status: string; statusId: string; lockVersion: number }) => void;
  // Column-level controls (inline on the board, no need to open Settings).
  onToggleColumnVisible: (statusId: string) => void;
  onMoveColumn: (statusId: string, direction: "up" | "down") => void;
};

export default function KanbanBoard({
  tasks, availableStatuses, columns, weights, authToken, authUrl, gitlabTaskIds,
  onTaskClick, onStatusChanged, onToggleColumnVisible, onMoveColumn,
}: Props) {
  const { addToast } = useToast();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // statusId → tasks. Tasks whose status isn't visible go into "overflow".
  const buckets = useMemo(() => {
    const visibleIds = new Set(columns.filter(c => c.visible).map(c => c.statusId));
    const map = new Map<string, TodoItem[]>();
    const overflow: TodoItem[] = [];
    for (const c of columns) if (c.visible) map.set(c.statusId, []);
    for (const t of tasks) {
      if (t.statusId && visibleIds.has(t.statusId)) {
        map.get(t.statusId)!.push(t);
      } else {
        overflow.push(t);
      }
    }
    return { map, overflow };
  }, [columns, tasks]);

  const visibleColumns = columns.filter(c => c.visible);
  const hiddenColumns = columns.filter(c => !c.visible);

  async function handleDropTask(targetStatusId: string, taskId: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    if (task.statusId === targetStatusId) return;
    if (!authToken || !authUrl) {
      addToast("Sem credenciais para alterar estado.", "error");
      return;
    }
    if (typeof task.lockVersion !== "number") {
      addToast("Falta lockVersion — recarrega a sessao.", "error");
      return;
    }

    const newStatus = availableStatuses.find(s => s.id === targetStatusId);
    const prevStatusId = task.statusId || "";
    const prevStatusName = task.status || "";

    onStatusChanged(taskId, {
      status: newStatus?.name || task.status || "",
      statusId: targetStatusId,
      lockVersion: task.lockVersion,
    });

    try {
      const response = await fetch("/api/openproject/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-OpenProject-URL": authUrl,
        },
        body: JSON.stringify({ taskId, statusId: targetStatusId, lockVersion: task.lockVersion }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onStatusChanged(taskId, { status: prevStatusName, statusId: prevStatusId, lockVersion: task.lockVersion });
        addToast(data?.message || `Erro a alterar estado (${response.status}).`, "error");
        return;
      }
      onStatusChanged(taskId, {
        status: data.status || newStatus?.name || "",
        statusId: data.statusId || targetStatusId,
        lockVersion: typeof data.lockVersion === "number" ? data.lockVersion : task.lockVersion + 1,
      });
      addToast(`Estado alterado para ${data.status || newStatus?.name}.`, "success");
    } catch (err) {
      onStatusChanged(taskId, { status: prevStatusName, statusId: prevStatusId, lockVersion: task.lockVersion });
      addToast(`Erro de rede: ${err instanceof Error ? err.message : "tenta de novo"}.`, "error");
    }
  }

  if (visibleColumns.length === 0 && buckets.overflow.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-sm text-slate-700 dark:text-slate-200 font-medium mb-1">Sem colunas configuradas.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Adiciona um estado para comecar.
          </p>
          {hiddenColumns.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {hiddenColumns.map(c => {
                const s = availableStatuses.find(s => s.id === c.statusId);
                if (!s) return null;
                return (
                  <button
                    key={c.statusId}
                    onClick={() => onToggleColumnVisible(c.statusId)}
                    className="rounded-full bg-indigo-100 dark:bg-indigo-950/40 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition"
                  >
                    + {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
        <div className="flex gap-3 h-full">
          {visibleColumns.map((col, i) => {
            const status = availableStatuses.find(s => s.id === col.statusId);
            const items = buckets.map.get(col.statusId) || [];
            return (
              <KanbanColumn
                key={col.statusId}
                title={status?.name || `#${col.statusId}`}
                count={items.length}
                onDropTask={(taskId) => handleDropTask(col.statusId, taskId)}
                canMoveLeft={i > 0}
                canMoveRight={i < visibleColumns.length - 1}
                onMoveLeft={() => onMoveColumn(col.statusId, "up")}
                onMoveRight={() => onMoveColumn(col.statusId, "down")}
                onHide={() => onToggleColumnVisible(col.statusId)}
                isTerminal={Boolean(status?.isClosed)}
              >
                {items.length === 0 ? (
                  <p className="text-[11px] italic text-slate-400 dark:text-slate-500 text-center py-4">
                    Arrasta tarefas para aqui
                  </p>
                ) : items.map(t => (
                  <KanbanCard
                    key={t.id}
                    todo={t}
                    weights={weights}
                    hasGitlabActivity={gitlabTaskIds?.has(t.id)}
                    isDragging={draggingId === t.id}
                    onClick={() => onTaskClick(t)}
                    onDragStart={(id) => setDraggingId(id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))}
              </KanbanColumn>
            );
          })}

          {buckets.overflow.length > 0 && (
            <KanbanColumn
              title="Outros"
              count={buckets.overflow.length}
              variant="overflow"
              onDropTask={() => {
                addToast("A coluna Outros nao aceita drops — activa o estado correspondente.", "warning");
              }}
            >
              {buckets.overflow.map(t => (
                <KanbanCard
                  key={t.id}
                  todo={t}
                  weights={weights}
                  hasGitlabActivity={gitlabTaskIds?.has(t.id)}
                  isDragging={draggingId === t.id}
                  onClick={() => onTaskClick(t)}
                  onDragStart={(id) => setDraggingId(id)}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </KanbanColumn>
          )}

          {/* Add-column dropper at the right edge */}
          {hiddenColumns.length > 0 && (
            <div className="relative shrink-0 w-12 flex items-start justify-center pt-3">
              <button
                onClick={() => setShowAddMenu(v => !v)}
                title="Adicionar coluna"
                className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-2 text-xl font-light text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition"
              >
                +
              </button>
              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute top-12 right-0 z-20 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-2">
                    <p className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 px-1">
                      Estados disponiveis
                    </p>
                    <ul className="max-h-64 overflow-y-auto space-y-0.5">
                      {hiddenColumns.map(c => {
                        const s = availableStatuses.find(s => s.id === c.statusId);
                        if (!s) return null;
                        return (
                          <li key={c.statusId}>
                            <button
                              onClick={() => { onToggleColumnVisible(c.statusId); setShowAddMenu(false); }}
                              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                            >
                              <span className="text-slate-400">+</span>
                              <span className="flex-1 text-left truncate">{s.name}</span>
                              {s.isClosed && (
                                <span className="text-[9px] uppercase font-semibold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/40 px-1 rounded">
                                  terminal
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
