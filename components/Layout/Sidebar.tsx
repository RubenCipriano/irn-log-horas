"use client";

import { useMemo, useState } from "react";
import type { TodoItem, SprintInfo } from "@/types";

type Props = {
  userName?: string;
  userEmail?: string;
  url: string;
  onLogout: () => void;
  todos: TodoItem[];
  sprints: SprintInfo[];
  activeSprint: string | null;
  setActiveSprint: (s: string | null) => void;
  pinnedTaskIds: string[];
  onTaskClick: (todo: TodoItem) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function Sidebar({
  userName, userEmail, url, onLogout,
  todos, sprints, activeSprint, setActiveSprint,
  pinnedTaskIds, onTaskClick, collapsed, setCollapsed,
}: Props) {
  const [query, setQuery] = useState("");

  const availableSprints = useMemo(() => {
    const set = new Set<string>();
    todos.forEach(t => { if (t.sprint) set.add(t.sprint); });
    return Array.from(set).sort();
  }, [todos]);

  const filteredTasks = useMemo(() => {
    const filtered = activeSprint
      ? todos.filter(t => t.sprint === activeSprint)
      : todos;
    if (!query.trim()) return filtered;
    const q = normalize(query);
    return filtered.filter(t => normalize(t.title).includes(q) || t.id.includes(q));
  }, [todos, activeSprint, query]);

  const activeSprintInfo = activeSprint ? sprints.find(s => s.name === activeSprint) : null;

  if (collapsed) {
    return (
      <aside className="w-12 shrink-0 h-full bg-[var(--surface-2)] dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col items-center py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
          title="Expandir sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 h-full max-h-screen bg-[var(--surface-2)] dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
      {/* User */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-start gap-2">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center text-xs font-semibold shrink-0">
          {userName?.[0]?.toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{userName || "Sem nome"}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{userEmail || url}</p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition shrink-0"
          title="Colapsar sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Sprint filter */}
      {availableSprints.length > 0 && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-700">
          <label className="block text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">Sprint</label>
          <select
            value={activeSprint || ""}
            onChange={(e) => setActiveSprint(e.target.value || null)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Todas</option>
            {availableSprints.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {activeSprintInfo?.startDate && activeSprintInfo?.endDate && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5">
              {new Date(activeSprintInfo.startDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })} —{" "}
              {new Date(activeSprintInfo.endDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-700">
        <div className="relative">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Procurar tarefa..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-7 pr-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-2">
        <p className="px-1 pb-2 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
          Tarefas ({filteredTasks.length})
        </p>
        <ul className="space-y-1">
          {filteredTasks.map(t => {
            const isPinned = pinnedTaskIds.includes(t.id);
            return (
              <li key={t.id}>
                <button
                  onClick={() => onTaskClick(t)}
                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 transition group"
                >
                  <div className="flex items-start gap-1.5">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-900 dark:text-slate-100 truncate">{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">#{t.id}</span>
                        {t.status && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">· {t.status}</span>
                        )}
                        {isPinned && (
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400">· fixa</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {filteredTasks.length === 0 && (
            <li className="text-xs text-slate-400 text-center py-4">Nenhuma tarefa encontrada.</li>
          )}
        </ul>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={onLogout}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
        >
          Terminar sessao
        </button>
      </div>
    </aside>
  );
}
