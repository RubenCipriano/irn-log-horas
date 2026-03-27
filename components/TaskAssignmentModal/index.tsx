"use client";

import { useState } from "react";
import type { TodoItem } from "@/types";

type TaskAssignmentModalProps = {
  dayLabel: string;
  allTasks: TodoItem[];
  assignedTaskIds: string[];
  onAssign: (taskId: string, taskTitle: string) => void;
  onUnassign: (taskId: string) => void;
  onClose: () => void;
};

export default function TaskAssignmentModal({
  dayLabel,
  allTasks,
  assignedTaskIds,
  onAssign,
  onUnassign,
  onClose,
}: TaskAssignmentModalProps) {
  const [search, setSearch] = useState("");

  const filteredTasks = allTasks.filter(task =>
    task.title.toLowerCase().includes(search.toLowerCase()) ||
    task.id.includes(search)
  );

  const assignedTasks = filteredTasks.filter(t => assignedTaskIds.includes(t.id));
  const unassignedTasks = filteredTasks.filter(t => !assignedTaskIds.includes(t.id));

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
              Atribuir Tarefas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {dayLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
          >
            x
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar tarefas..."
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-500 focus:outline-none mb-4"
        />

        <div className="overflow-y-auto flex-1 space-y-1">
          {assignedTasks.length > 0 && (
            <>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase mb-2">
                Atribuidas ({assignedTasks.length})
              </p>
              {assignedTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-2"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 truncate">
                      {task.title}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">
                      ID: {task.id}
                    </p>
                  </div>
                  <button
                    onClick={() => onUnassign(task.id)}
                    className="shrink-0 rounded-lg bg-red-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-600"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </>
          )}

          {unassignedTasks.length > 0 && (
            <>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase mb-2 mt-3">
                Disponiveis ({unassignedTasks.length})
              </p>
              {unassignedTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-2"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {task.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      ID: {task.id} {task.status && `| ${task.status}`}
                    </p>
                  </div>
                  <button
                    onClick={() => onAssign(task.id, task.title)}
                    className="shrink-0 rounded-lg bg-indigo-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-600"
                  >
                    Adicionar
                  </button>
                </div>
              ))}
            </>
          )}

          {filteredTasks.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
              Nenhuma tarefa encontrada
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
