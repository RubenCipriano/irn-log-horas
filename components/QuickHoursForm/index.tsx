"use client";

import { useMemo, useState } from "react";
import type { TodoItem, SmartRecommendation, Recommendation, TaskStatusTimeline, StatusWeightConfig } from "@/types";
import { formatHours } from "@/lib/calendar-utils";
import { calculateSmartRecommendations } from "@/lib/recommendations";

type QuickHoursFormProps = {
  allTasks: TodoItem[];
  pinnedTaskIds: string[];
  expectedHours: number;
  actualHours: number;
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  meetingsHours?: number;
  isSaving: boolean;
  onSave: (recommendations: Recommendation[]) => void;
  dayKey?: string;
  timelines?: Record<string, TaskStatusTimeline>;
  statusWeights?: StatusWeightConfig;
};

export default function QuickHoursForm({
  allTasks,
  pinnedTaskIds,
  expectedHours,
  actualHours,
  meetingsTask,
  meetingsTaskId,
  meetingsHours,
  isSaving,
  onSave,
  dayKey,
  timelines,
  statusWeights,
}: QuickHoursFormProps) {
  // Base recommendations are derived from props (no setState-in-effect). User
  // edits (toggle / hours / distribute) live in `overrides` keyed by taskId and
  // are merged on top. Overrides reset when the day changes (render-time pattern).
  const baseRecommendations = useMemo(
    () => calculateSmartRecommendations({
      tasks: allTasks,
      pinnedTaskIds,
      expectedHours,
      alreadyRegistered: actualHours,
      meetingsTask,
      meetingsTaskId,
      meetingsHours,
      dayKey,
      timelines,
      statusWeights,
    }),
    [allTasks, pinnedTaskIds, expectedHours, actualHours, meetingsTask, meetingsTaskId, meetingsHours, dayKey, timelines, statusWeights],
  );

  const [overrides, setOverrides] = useState<Record<string, { selected?: boolean; hours?: number }>>({});
  const [prevDayKey, setPrevDayKey] = useState(dayKey);
  if (dayKey !== prevDayKey) {
    setPrevDayKey(dayKey);
    setOverrides({});
  }

  const recommendations = useMemo<SmartRecommendation[]>(
    () => baseRecommendations.map(r => (overrides[r.taskId] ? { ...r, ...overrides[r.taskId] } : r)),
    [baseRecommendations, overrides],
  );

  const hoursNeeded = Math.max(0, expectedHours - actualHours);
  const selectedRecs = recommendations.filter(r => r.selected);
  const totalSelected = selectedRecs.reduce((sum, r) => sum + r.hours, 0);
  const shortfall = Math.max(0, Math.round((hoursNeeded - totalSelected) * 2) / 2);

  const toggleTask = (taskId: string) => {
    if (taskId === meetingsTask?.id) return; // can't toggle meetings
    const rec = recommendations.find(r => r.taskId === taskId);
    if (!rec) return;
    const nextSelected = !rec.selected;
    setOverrides(prev => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        selected: nextSelected,
        hours: nextSelected ? Math.max(rec.hours, 0.5) : rec.hours,
      },
    }));
  };

  const updateHours = (taskId: string, hours: number) => {
    setOverrides(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], hours: Math.max(0, hours) },
    }));
  };

  const distributeRemainder = () => {
    const selected = recommendations.filter(r => r.selected);
    const currentTotal = selected.reduce((sum, r) => sum + r.hours, 0);
    const diff = hoursNeeded - currentTotal;
    if (diff <= 0 || selected.length === 0) return;

    // Distribute equally among selected (excluding meetings)
    const adjustable = selected.filter(r => r.taskId !== meetingsTask?.id);
    if (adjustable.length === 0) return;

    const extra = Math.round((diff / adjustable.length) * 2) / 2;
    const targetHours = new Map<string, number>();
    for (const rec of adjustable) targetHours.set(rec.taskId, rec.hours + extra);

    // Fix rounding on the last adjustable task.
    const newTotal = selected.reduce((sum, r) => sum + (targetHours.get(r.taskId) ?? r.hours), 0);
    const roundingDiff = Math.round((hoursNeeded - newTotal) * 2) / 2;
    if (roundingDiff !== 0) {
      const last = adjustable[adjustable.length - 1];
      targetHours.set(last.taskId, (targetHours.get(last.taskId) ?? last.hours) + roundingDiff);
    }

    setOverrides(prev => {
      const next = { ...prev };
      for (const [taskId, hours] of targetHours) {
        next[taskId] = { ...next[taskId], selected: true, hours };
      }
      return next;
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

  const sourceLabel = (source: SmartRecommendation["source"]) => {
    if (source === "pinned") return "Atribuida";
    if (source === "activity") return "Em curso";
    return "";
  };

  const sourceColor = (source: SmartRecommendation["source"]) => {
    if (source === "pinned") return "text-indigo-600 dark:text-indigo-400";
    if (source === "activity") return "text-emerald-600 dark:text-emerald-400";
    return "text-slate-500";
  };

  return (
    <div className="mt-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-4">
      <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-1">
        Em que trabalhaste?
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Seleciona as tarefas e define as horas
      </p>

      <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
        {recommendations.map((rec) => (
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
              onChange={() => toggleTask(rec.taskId)}
              disabled={rec.taskId === meetingsTask?.id}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 min-w-0">
              <p className="truncate text-slate-900 dark:text-slate-100">{rec.taskTitle}</p>
              {rec.source !== "available" && (
                <span className={`text-[10px] font-medium ${sourceColor(rec.source)}`}>
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
                onChange={(e) => updateHours(rec.taskId, parseFloat(e.target.value) || 0)}
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

      {/* Daily-cap guard: total + already-registered exceeds expected */}
      {(totalSelected + actualHours) > expectedHours && expectedHours > 0 && (
        <div className="mb-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-2 text-xs text-rose-700 dark:text-rose-300">
          Estas a passar <strong>{formatHours((totalSelected + actualHours) - expectedHours)}h</strong> do limite diario ({formatHours(expectedHours)}h). Reduz as horas antes de guardar.
        </div>
      )}

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
          disabled={isSaving || selectedRecs.length === 0 || (totalSelected + actualHours) > expectedHours}
          title={(totalSelected + actualHours) > expectedHours ? "Ajusta as horas para nao passar o limite diario" : ""}
          className="flex-1 rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Guardando..." : "Guardar Horas"}
        </button>
      </div>
    </div>
  );
}
