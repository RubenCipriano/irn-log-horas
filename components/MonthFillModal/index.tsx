"use client";

import { useState, useMemo } from "react";
import type { TodoItem, Recommendation, TimeEntriesData } from "@/types";
import { formatHours, toKey, getDaysInMonth, WEEKDAYS_PT, MONTHS_PT } from "@/lib/calendar-utils";
import { calculateSmartRecommendations } from "@/lib/recommendations";
import { getActiveTasksForDay } from "@/lib/task-filtering";

type MonthDay = {
  date: Date;
  dayKey: string;
  dayNumber: number;
  weekdayIndex: number;
  expectedHours: number;
  actualHours: number;
  hoursToAdd: number;
};

type MonthFillModalProps = {
  currentYear: number;
  currentMonth: number;
  timeEntries: TimeEntriesData;
  allTasks: TodoItem[];
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  getExpectedHours: (date: Date) => number | null;
  isHoliday: (dayKey: string) => boolean;
  isSaving: boolean;
  onSave: (dayEntries: { date: Date; recommendations: Recommendation[] }[]) => void;
  onClose: () => void;
};

function getMonthWorkDays(
  year: number, month: number,
  isHoliday: (k: string) => boolean,
  getExpectedHours: (d: Date) => number | null,
  timeEntries: TimeEntriesData,
): MonthDay[] {
  const total = getDaysInMonth(year, month);
  const days: MonthDay[] = [];
  for (let d = 1; d <= total; d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    const dayKey = toKey(date);
    if (isHoliday(dayKey)) continue;
    const expected = getExpectedHours(date) ?? 0;
    if (expected === 0) continue;
    const actual = timeEntries.byDay[dayKey] || 0;
    days.push({
      date, dayKey, dayNumber: d,
      weekdayIndex: (dow + 6) % 7,
      expectedHours: expected,
      actualHours: actual,
      hoursToAdd: Math.max(0, expected - actual),
    });
  }
  return days;
}

function groupByWeeks(days: MonthDay[]): MonthDay[][] {
  if (days.length === 0) return [];
  const weeks: MonthDay[][] = [];
  let current: MonthDay[] = [];
  let lastMonday = -1;
  for (const day of days) {
    const monday = day.dayNumber - day.weekdayIndex;
    if (monday !== lastMonday && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(day);
    lastMonday = monday;
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}

export default function MonthFillModal({
  currentYear, currentMonth, timeEntries, allTasks,
  meetingsTask, meetingsTaskId, getExpectedHours, isHoliday,
  isSaving, onSave, onClose,
}: MonthFillModalProps) {
  const days = useMemo(() =>
    getMonthWorkDays(currentYear, currentMonth, isHoliday, getExpectedHours, timeEntries),
    [currentYear, currentMonth, isHoliday, getExpectedHours, timeEntries]
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() =>
    new Set(days.filter(d => d.actualHours < d.expectedHours).map(d => d.dayKey))
  );

  const weeks = useMemo(() => groupByWeeks(days), [days]);

  // Calculate per-day recommendations automatically
  const dayRecommendations = useMemo(() => {
    const result: Record<string, Recommendation[]> = {};
    for (const day of days) {
      if (!selectedKeys.has(day.dayKey)) continue;
      if (day.hoursToAdd === 0) continue;

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
  }, [days, selectedKeys, allTasks, timeEntries, meetingsTask, meetingsTaskId]);

  const selectedDays = days.filter(d => selectedKeys.has(d.dayKey));
  const totalHoursToAdd = selectedDays.reduce((sum, d) => sum + d.hoursToAdd, 0);

  const toggleDay = (dayKey: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const toggleWeek = (weekDays: MonthDay[]) => {
    const selectableDays = weekDays.filter(d => d.hoursToAdd > 0);
    const allSelected = selectableDays.every(d => selectedKeys.has(d.dayKey));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      for (const d of selectableDays) {
        if (allSelected) next.delete(d.dayKey);
        else next.add(d.dayKey);
      }
      return next;
    });
  };

  const handleSave = () => {
    const entries = selectedDays
      .filter(d => dayRecommendations[d.dayKey]?.length > 0)
      .map(d => ({ date: d.date, recommendations: dayRecommendations[d.dayKey] }));
    if (entries.length > 0) onSave(entries);
  };

  const dayStatusColor = (day: MonthDay, isSelected: boolean) => {
    if (!isSelected) return "bg-slate-100 dark:bg-slate-800 opacity-40";
    if (day.actualHours >= day.expectedHours) return "bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700";
    if (day.actualHours > 0) return "bg-yellow-100 dark:bg-yellow-900 border-yellow-300 dark:border-yellow-700";
    return "bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800";
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-2xl border border-slate-200 dark:border-slate-600 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
            Preencher Mes — {MONTHS_PT[currentMonth]} {currentYear}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold">x</button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3">
          {weeks.map((week, wi) => {
            const selectableDays = week.filter(d => d.hoursToAdd > 0);
            const allSel = selectableDays.length > 0 && selectableDays.every(d => selectedKeys.has(d.dayKey));
            return (
              <div key={wi}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Semana {wi + 1}</span>
                  {selectableDays.length > 0 && (
                    <button onClick={() => toggleWeek(week)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                      {allSel ? "Desmarcar" : "Selecionar"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {week.map(day => {
                    const isSelected = selectedKeys.has(day.dayKey);
                    const recs = dayRecommendations[day.dayKey] || [];
                    const complete = day.actualHours >= day.expectedHours;
                    return (
                      <button key={day.dayKey} onClick={() => !complete && toggleDay(day.dayKey)}
                        className={`rounded-lg border p-2 text-center text-xs transition ${dayStatusColor(day, isSelected || complete)} ${complete ? "cursor-default" : "cursor-pointer"}`}>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {WEEKDAYS_PT[day.weekdayIndex]} {day.dayNumber}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {formatHours(day.expectedHours)}h
                        </div>
                        {complete && (
                          <div className="text-green-600 dark:text-green-400 mt-0.5">Completo</div>
                        )}
                        {!complete && isSelected && day.hoursToAdd > 0 && (
                          <div className="text-indigo-700 dark:text-indigo-300 font-medium mt-0.5">
                            +{formatHours(day.hoursToAdd)}h
                          </div>
                        )}
                        {isSelected && recs.length > 0 && (
                          <div className="text-slate-400 dark:text-slate-500 mt-0.5">
                            {recs.length} tarefa{recs.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary + Actions */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300 mb-3">
            <span>Dias: <strong>{selectedDays.length}</strong> / {days.length}</span>
            <span>Total: <strong>{formatHours(totalHoursToAdd)}h</strong></span>
          </div>
          <div className="flex gap-2">
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
    </div>
  );
}
