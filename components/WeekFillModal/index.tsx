"use client";

import { useState, useMemo } from "react";
import type { TodoItem, Recommendation, TimeEntriesData } from "@/types";
import { formatHours, toKey, getWeekDays, WEEKDAYS_PT, MONTHS_PT } from "@/lib/calendar-utils";
import { calculateSmartRecommendations } from "@/lib/recommendations";
import { getActiveTasksForDay } from "@/lib/task-filtering";

type WeekDay = {
  date: Date;
  dayKey: string;
  label: string;
  expectedHours: number;
  actualHours: number;
  isHoliday: boolean;
};

type WeekFillModalProps = {
  currentYear: number;
  currentMonth: number;
  today: Date;
  timeEntries: TimeEntriesData;
  allTasks: TodoItem[];
  pinnedTaskIds: string[];
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  getExpectedHours: (date: Date) => number | null;
  isHoliday: (dayKey: string) => boolean;
  isSaving: boolean;
  onSave: (dayEntries: { date: Date; recommendations: Recommendation[] }[]) => void;
  onClose: () => void;
};

function formatWeekRange(ref: Date): string {
  const days = getWeekDays(ref);
  const first = days[0], last = days[days.length - 1];
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()}-${last.getDate()} ${MONTHS_PT[first.getMonth()]} ${first.getFullYear()}`;
  }
  return `${first.getDate()} ${MONTHS_PT[first.getMonth()]} - ${last.getDate()} ${MONTHS_PT[last.getMonth()]}`;
}

export default function WeekFillModal({
  today,
  timeEntries,
  allTasks,
  meetingsTask,
  meetingsTaskId,
  getExpectedHours,
  isHoliday,
  isSaving,
  onSave,
  onClose,
}: WeekFillModalProps) {
  const [referenceDate, setReferenceDate] = useState<Date>(today);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Compute week data from referenceDate
  const weekDays = useMemo(() => {
    const dates = getWeekDays(referenceDate);
    return dates.map(date => {
      const dayKey = toKey(date);
      const expected = isHoliday(dayKey) ? 0 : (getExpectedHours(date) ?? 0);
      const actual = timeEntries.byDay[dayKey] || 0;
      return {
        date, dayKey,
        label: `${WEEKDAYS_PT[(date.getDay() + 6) % 7]} ${date.getDate()}`,
        expectedHours: expected,
        actualHours: actual,
        isHoliday: isHoliday(dayKey),
      };
    });
  }, [referenceDate, timeEntries, isHoliday, getExpectedHours]);

  // Auto-select incomplete days when week changes
  useMemo(() => {
    const autoSelected = new Set(
      weekDays.filter(d => d.expectedHours > 0 && d.actualHours < d.expectedHours && !d.isHoliday).map(d => d.dayKey)
    );
    setSelectedKeys(autoSelected);
    setInitialized(true);
  }, [weekDays]);

  // Calculate per-day recommendations automatically
  const dayRecommendations = useMemo(() => {
    const result: Record<string, Recommendation[]> = {};
    for (const day of weekDays) {
      if (!selectedKeys.has(day.dayKey)) continue;
      const hoursNeeded = Math.max(0, day.expectedHours - day.actualHours);
      if (hoursNeeded === 0) continue;

      const activeTasks = getActiveTasksForDay(allTasks, day.dayKey);
      const recs = calculateSmartRecommendations({
        tasks: activeTasks,
        pinnedTaskIds: [],
        taskHistory: timeEntries.byTask,
        expectedHours: day.expectedHours,
        alreadyRegistered: day.actualHours,
        meetingsTask,
        meetingsTaskId,
        dayKey: day.dayKey,
      });
      result[day.dayKey] = recs.filter(r => r.selected && r.hours > 0).map(r => ({
        taskId: r.taskId, taskTitle: r.taskTitle, hours: r.hours,
      }));
    }
    return result;
  }, [weekDays, selectedKeys, allTasks, timeEntries, meetingsTask, meetingsTaskId]);

  const selectedDays = weekDays.filter(d => selectedKeys.has(d.dayKey));

  const toggleDay = (dayKey: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const goToPrevWeek = () => setReferenceDate(prev => {
    const d = new Date(prev); d.setDate(d.getDate() - 7); return d;
  });
  const goToNextWeek = () => setReferenceDate(prev => {
    const d = new Date(prev); d.setDate(d.getDate() + 7); return d;
  });

  const handleSave = () => {
    const entries = selectedDays
      .filter(d => dayRecommendations[d.dayKey]?.length > 0)
      .map(d => ({ date: d.date, recommendations: dayRecommendations[d.dayKey] }));
    if (entries.length > 0) onSave(entries);
  };

  if (!initialized) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-lg border border-slate-200 dark:border-slate-600 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header with week navigation */}
        <div className="flex items-start justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">Preencher Semana</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold">x</button>
        </div>
        <div className="flex items-center justify-center gap-3 mb-4">
          <button onClick={goToPrevWeek} className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            &lt;
          </button>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {formatWeekRange(referenceDate)}
          </span>
          <button onClick={goToNextWeek} className="rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
            &gt;
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Day list with automatic preview */}
          <div className="space-y-2">
            {weekDays.map(day => {
              const recs = dayRecommendations[day.dayKey] || [];
              const isSelected = selectedKeys.has(day.dayKey);
              const needed = Math.max(0, day.expectedHours - day.actualHours);
              const complete = day.actualHours >= day.expectedHours && day.expectedHours > 0;

              return (
                <div key={day.dayKey}
                  className={`rounded-lg border p-3 transition ${
                    day.isHoliday ? "opacity-40 border-slate-200 dark:border-slate-700" :
                    complete ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950" :
                    isSelected ? "border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950" :
                    "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  }`}>
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleDay(day.dayKey)}
                        disabled={day.isHoliday || complete}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{day.label}</span>
                      {day.isHoliday && <span className="text-xs text-emerald-600">Feriado</span>}
                      {complete && <span className="text-xs text-green-600">Completo</span>}
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {day.actualHours > 0 ? `${formatHours(day.actualHours)}/` : ""}{formatHours(day.expectedHours)}h
                    </span>
                  </label>

                  {/* Per-day task preview */}
                  {isSelected && recs.length > 0 && (
                    <div className="mt-2 pl-6 space-y-0.5">
                      {recs.map(r => (
                        <div key={r.taskId} className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                          <span className="truncate mr-2">{r.taskTitle}</span>
                          <span className="font-medium shrink-0">{formatHours(r.hours)}h</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs font-semibold text-indigo-700 dark:text-indigo-300 pt-0.5">
                        <span>Total</span>
                        <span>{formatHours(recs.reduce((s, r) => s + r.hours, 0))}h</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600">
            Cancelar
          </button>
          <button onClick={handleSave}
            disabled={isSaving || selectedDays.length === 0}
            className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSaving ? "Guardando..." : `Guardar ${selectedDays.length} dia(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
