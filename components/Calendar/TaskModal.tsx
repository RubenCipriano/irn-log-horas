"use client";

import type { TodoItem, StatusWeightConfig } from "@/types";
import ActivityTimelineStrip from "@/components/ActivityTimelineStrip";
import ModalCloseButton from "@/components/ModalCloseButton";

type TaskModalProps = {
  todo: TodoItem;
  statusWeights?: StatusWeightConfig;
  onClose: () => void;
  onInferredClick?: (taskTitle: string, segment: { status: string; fromDate: string; toDate: string | null }) => void;
};

export default function TaskModal({ todo, statusWeights, onClose, onInferredClick }: TaskModalProps) {
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
              <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Estado</p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {todo.status || "—"}
              </p>
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

          {todo.url && (
            <a
              href={todo.url}
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
