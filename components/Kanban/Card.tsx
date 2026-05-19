"use client";

import type { TodoItem, StatusWeightConfig } from "@/types";
import { resolveStatusWeight } from "@/lib/status-timeline";

function pipColor(w: number): string {
  if (w >= 0.8) return "bg-emerald-500";
  if (w >= 0.4) return "bg-amber-400";
  if (w > 0) return "bg-orange-400";
  return "bg-slate-300 dark:bg-slate-600";
}

type Props = {
  todo: TodoItem;
  weights: StatusWeightConfig;
  hasGitlabActivity?: boolean; // small indicator if any recent commit/MR matched this taskId
  isDragging?: boolean;
  onClick: () => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
};

export default function KanbanCard({ todo, weights, hasGitlabActivity, isDragging, onClick, onDragStart, onDragEnd }: Props) {
  const weight = resolveStatusWeight(todo.status, weights);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", todo.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(todo.id);
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group rounded-lg border bg-white dark:bg-slate-900 p-2.5 cursor-grab active:cursor-grabbing transition shadow-sm hover:shadow border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${pipColor(weight)}`} title={`peso ${weight.toFixed(1)}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">{todo.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">#{todo.id}</span>
            {todo.sprint && (
              <span className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate max-w-[12rem]">· {todo.sprint}</span>
            )}
            {hasGitlabActivity && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-950/40 px-1 py-0.5 rounded">
                GitLab
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
