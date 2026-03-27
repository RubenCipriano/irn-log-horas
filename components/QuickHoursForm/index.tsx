"use client";

import { useEffect, useState } from "react";
import type { TodoItem, SmartRecommendation, TaskHistory, Recommendation } from "@/types";
import { formatHours } from "@/lib/calendar-utils";
import { calculateSmartRecommendations } from "@/lib/recommendations";

type QuickHoursFormProps = {
  allTasks: TodoItem[];
  pinnedTaskIds: string[];
  taskHistory: Record<string, TaskHistory>;
  expectedHours: number;
  actualHours: number;
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  isSaving: boolean;
  onSave: (recommendations: Recommendation[]) => void;
};

export default function QuickHoursForm({
  allTasks,
  pinnedTaskIds,
  taskHistory,
  expectedHours,
  actualHours,
  meetingsTask,
  meetingsTaskId,
  isSaving,
  onSave,
}: QuickHoursFormProps) {
  const [recommendations, setRecommendations] = useState<SmartRecommendation[]>([]);

  // Calculate smart recommendations on mount
  useEffect(() => {
    const recs = calculateSmartRecommendations({
      tasks: allTasks,
      pinnedTaskIds,
      taskHistory,
      expectedHours,
      alreadyRegistered: actualHours,
      meetingsTask,
      meetingsTaskId,
    });
    setRecommendations(recs);
  }, [allTasks, pinnedTaskIds, taskHistory, expectedHours, actualHours, meetingsTask, meetingsTaskId]);

  const hoursNeeded = Math.max(0, expectedHours - actualHours);
  const selectedRecs = recommendations.filter(r => r.selected);
  const totalSelected = selectedRecs.reduce((sum, r) => sum + r.hours, 0);
  const shortfall = Math.max(0, Math.round((hoursNeeded - totalSelected) * 2) / 2);

  const toggleTask = (index: number) => {
    setRecommendations(prev => {
      const updated = [...prev];
      const rec = updated[index];
      if (rec.taskId === meetingsTask?.id) return prev; // can't toggle meetings
      updated[index] = {
        ...rec,
        selected: !rec.selected,
        hours: !rec.selected ? Math.max(rec.hours, 0.5) : rec.hours,
      };
      return updated;
    });
  };

  const updateHours = (index: number, hours: number) => {
    setRecommendations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], hours: Math.max(0, hours) };
      return updated;
    });
  };

  const distributeRemainder = () => {
    setRecommendations(prev => {
      const updated = [...prev];
      const selected = updated.filter(r => r.selected);
      const currentTotal = selected.reduce((sum, r) => sum + r.hours, 0);
      const diff = hoursNeeded - currentTotal;
      if (diff <= 0 || selected.length === 0) return prev;

      // Distribute equally among selected (excluding meetings)
      const adjustable = selected.filter(r => r.taskId !== meetingsTask?.id);
      if (adjustable.length === 0) return prev;

      const extra = Math.round((diff / adjustable.length) * 2) / 2;
      for (const rec of adjustable) {
        const idx = updated.indexOf(rec);
        updated[idx] = { ...rec, hours: rec.hours + extra };
      }
      // Fix rounding
      const newTotal = updated.filter(r => r.selected).reduce((sum, r) => sum + r.hours, 0);
      const roundingDiff = Math.round((hoursNeeded - newTotal) * 2) / 2;
      if (roundingDiff !== 0) {
        const lastAdj = adjustable[adjustable.length - 1];
        const lastIdx = updated.indexOf(lastAdj);
        updated[lastIdx] = { ...updated[lastIdx], hours: updated[lastIdx].hours + roundingDiff };
      }
      return updated;
    });
  };

  const handleSave = () => {
    const toSave = recommendations
      .filter(r => r.selected && r.hours > 0)
      .map(r => ({ taskId: r.taskId, taskTitle: r.taskTitle, hours: r.hours }));
    if (toSave.length > 0) onSave(toSave);
  };

  if (hoursNeeded === 0) {
    return (
      <div className="mt-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4">
        <p className="text-sm text-green-800 dark:text-green-200">Este dia ja tem todas as horas registadas!</p>
      </div>
    );
  }

  const hasHistoryBased = recommendations.some(r => r.source === "history" && r.selected);

  const sourceLabel = (source: SmartRecommendation["source"]) => {
    if (source === "pinned") return "Atribuida";
    if (source === "history") return "Historico";
    return "";
  };

  return (
    <div className="mt-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-4">
      <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-1">
        Em que trabalhaste?
      </p>
      {hasHistoryBased && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
          Horas pre-preenchidas com base no teu historico
        </p>
      )}
      {!hasHistoryBased && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Seleciona as tarefas e define as horas
        </p>
      )}

      <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
        {recommendations.map((rec, idx) => (
          <div
            key={rec.taskId}
            className={`flex items-center gap-2 rounded-lg p-2 text-sm transition ${
              rec.selected
                ? "bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700"
                : "bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 opacity-60"
            }`}
          >
            <input
              type="checkbox"
              checked={rec.selected}
              onChange={() => toggleTask(idx)}
              disabled={rec.taskId === meetingsTask?.id}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-slate-900 dark:text-slate-100">{rec.taskTitle}</p>
              {rec.source !== "available" && (
                <span className={`text-[10px] font-medium ${
                  rec.source === "pinned" ? "text-indigo-600 dark:text-indigo-400" : "text-amber-600 dark:text-amber-400"
                }`}>
                  {sourceLabel(rec.source)}
                </span>
              )}
            </div>
            {rec.selected && (
              <input
                type="number"
                min={0}
                max={12}
                step={0.5}
                value={rec.hours}
                onChange={(e) => updateHours(idx, parseFloat(e.target.value) || 0)}
                className="w-16 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-center font-semibold text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between rounded-lg bg-indigo-100 dark:bg-indigo-900 p-2 text-sm mb-3">
        <span className="text-indigo-900 dark:text-indigo-100">
          Total: <strong>{formatHours(totalSelected)}</strong> / {formatHours(hoursNeeded)}
        </span>
        {shortfall > 0 && (
          <span className="text-amber-700 dark:text-amber-300 text-xs">
            Falta: {formatHours(shortfall)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {shortfall > 0 && selectedRecs.length > 0 && (
          <button
            onClick={distributeRemainder}
            className="flex-1 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 transition hover:bg-indigo-50 dark:hover:bg-indigo-900"
          >
            Distribuir Resto
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving || selectedRecs.length === 0}
          className="flex-1 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Guardando..." : "Guardar Horas"}
        </button>
      </div>
    </div>
  );
}
