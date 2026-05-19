"use client";

import { useState } from "react";
import type { TodoItem, StatusWeightConfig, AvailableStatus } from "@/types";
import ActivityTimelineStrip from "@/components/ActivityTimelineStrip";
import ModalCloseButton from "@/components/ModalCloseButton";
import { useToast } from "@/components/Toast";

type StatusChangeResult = {
  status: string;
  statusId: string;
  lockVersion: number;
};

type TaskModalProps = {
  todo: TodoItem;
  statusWeights?: StatusWeightConfig;
  availableStatuses?: AvailableStatus[];
  authToken?: string | null;
  authUrl?: string;
  onClose: () => void;
  onInferredClick?: (taskTitle: string, segment: { status: string; fromDate: string; toDate: string | null }) => void;
  onStatusChanged?: (taskId: string, result: StatusChangeResult) => void;
};

export default function TaskModal({
  todo, statusWeights, availableStatuses, authToken, authUrl, onClose, onInferredClick, onStatusChanged,
}: TaskModalProps) {
  const { addToast } = useToast();
  // Local view of the status; lets us optimistically reflect a change and revert on failure.
  const [currentStatusId, setCurrentStatusId] = useState<string | undefined>(todo.statusId);
  const [currentStatusName, setCurrentStatusName] = useState<string | undefined>(todo.status);
  const [isUpdating, setIsUpdating] = useState(false);

  const canEditStatus = Boolean(
    authToken && authUrl && todo.id && typeof todo.lockVersion === "number" && availableStatuses && availableStatuses.length > 0
  );

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatusId = e.target.value;
    if (!newStatusId || newStatusId === currentStatusId) return;
    if (!authToken || !authUrl || typeof todo.lockVersion !== "number") return;

    const prevStatusId = currentStatusId;
    const prevStatusName = currentStatusName;
    const newStatus = availableStatuses?.find(s => s.id === newStatusId);

    // Optimistic UI: show the new status name immediately.
    setCurrentStatusId(newStatusId);
    setCurrentStatusName(newStatus?.name || newStatusId);
    setIsUpdating(true);

    try {
      const response = await fetch("/api/openproject/update-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-OpenProject-URL": authUrl,
        },
        body: JSON.stringify({
          taskId: todo.id,
          statusId: newStatusId,
          lockVersion: todo.lockVersion,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Revert + actionable toast
        setCurrentStatusId(prevStatusId);
        setCurrentStatusName(prevStatusName);
        addToast(data?.message || `Erro a alterar estado (${response.status}).`, "error");
        return;
      }

      const result: StatusChangeResult = {
        status: data.status || newStatus?.name || "",
        statusId: data.statusId || newStatusId,
        lockVersion: typeof data.lockVersion === "number" ? data.lockVersion : todo.lockVersion + 1,
      };
      setCurrentStatusId(result.statusId);
      setCurrentStatusName(result.status);
      addToast(`Estado alterado para ${result.status}.`, "success");
      onStatusChanged?.(todo.id, result);
    } catch (err) {
      setCurrentStatusId(prevStatusId);
      setCurrentStatusName(prevStatusName);
      addToast(`Erro de rede: ${err instanceof Error ? err.message : "tenta de novo"}.`, "error");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700 animate-slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">#{todo.id}</p>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              {todo.title}
            </h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Estado</p>
                {isUpdating && (
                  <span className="h-3 w-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                )}
              </div>
              {canEditStatus ? (
                <select
                  value={currentStatusId || ""}
                  onChange={handleStatusChange}
                  disabled={isUpdating}
                  className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
                >
                  {!availableStatuses?.find(s => s.id === currentStatusId) && currentStatusName && (
                    <option value={currentStatusId || ""}>{currentStatusName}</option>
                  )}
                  {availableStatuses?.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                  {currentStatusName || "—"}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5">
              <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Sprint</p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                {todo.sprint || "—"}
              </p>
            </div>
          </div>

          {todo.timeline && statusWeights && (
            <div>
              <ActivityTimelineStrip
                timeline={todo.timeline}
                weights={statusWeights}
                onInferredClick={onInferredClick ? (seg) => onInferredClick(todo.title, seg) : undefined}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Ativa desde</span>
              <p className="text-slate-900 dark:text-slate-100 font-medium">
                {todo.activeFrom
                  ? new Date(todo.activeFrom + "T00:00:00").toLocaleDateString("pt-PT")
                  : "—"}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Ativa ate</span>
              <p className="text-slate-900 dark:text-slate-100 font-medium">
                {todo.activeUntil
                  ? new Date(todo.activeUntil + "T00:00:00").toLocaleDateString("pt-PT")
                  : "agora"}
              </p>
            </div>
          </div>

          {authUrl && todo.id && (
            <a
              href={`${authUrl.replace(/\/$/, "")}/work_packages/${todo.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Abrir no OpenProject
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M6 3h7v7M13 3L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
