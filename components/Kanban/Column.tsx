"use client";

import { useState } from "react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  count: number;
  variant?: "default" | "overflow";
  onDropTask: (taskId: string) => void;
  children: ReactNode;
  // Inline column controls — omitted for the overflow column.
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onHide?: () => void;
  isTerminal?: boolean;
};

export default function KanbanColumn({
  title, count, variant = "default", onDropTask, children,
  canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onHide, isTerminal,
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false);

  const isOverflow = variant === "overflow";

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) onDropTask(taskId);
      }}
      className={`group/col flex flex-col w-72 shrink-0 h-full rounded-xl border transition ${
        isOverflow
          ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
          : isDragOver
            ? "border-indigo-300 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/30 shadow-inner"
            : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40"
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <p className={`text-xs font-semibold truncate flex-1 min-w-0 ${
          isOverflow
            ? "text-slate-500 dark:text-slate-400 italic"
            : "text-slate-900 dark:text-slate-100"
        }`}>
          {title}
          {isTerminal && (
            <span className="ml-1.5 text-[9px] uppercase font-semibold text-rose-700 dark:text-rose-400">
              terminal
            </span>
          )}
        </p>
        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">{count}</span>
        {!isOverflow && (onMoveLeft || onMoveRight || onHide) && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100 transition shrink-0">
            {onMoveLeft && (
              <button
                onClick={onMoveLeft}
                disabled={!canMoveLeft}
                title="Mover para a esquerda"
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {onMoveRight && (
              <button
                onClick={onMoveRight}
                disabled={!canMoveRight}
                title="Mover para a direita"
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {onHide && (
              <button
                onClick={onHide}
                title="Esconder coluna"
                className="rounded p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {children}
      </div>
    </div>
  );
}
