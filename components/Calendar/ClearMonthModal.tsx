"use client";

import { useState, useMemo } from "react";
import type { TimeEntriesData } from "@/types";
import { formatHours, toKey, getDaysInMonth, WEEKDAYS_PT, MONTHS_PT } from "@/lib/calendar-utils";

type MonthDay = {
  date: Date;
  dayKey: string;
  dayNumber: number;
  weekdayIndex: number;
  hours: number;
};

type ClearMonthModalProps = {
  currentYear: number;
  currentMonth: number;
  timeEntries: TimeEntriesData;
  isHoliday: (dayKey: string) => boolean;
  isSaving: boolean;
  progress: { current: number; total: number } | null;
  onConfirm: (dates: Date[]) => void;
  onClose: () => void;
};

function getMonthDaysWithHours(
  year: number, month: number,
  isHoliday: (k: string) => boolean,
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
    const hours = timeEntries.byDay[dayKey] || 0;
    days.push({
      date, dayKey, dayNumber: d,
      weekdayIndex: (dow + 6) % 7,
      hours,
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

export default function ClearMonthModal({
  currentYear, currentMonth, timeEntries, isHoliday,
  isSaving, progress, onConfirm, onClose,
}: ClearMonthModalProps) {
  const days = useMemo(() =>
    getMonthDaysWithHours(currentYear, currentMonth, isHoliday, timeEntries),
    [currentYear, currentMonth, isHoliday, timeEntries]
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() =>
    new Set(days.filter(d => d.hours > 0).map(d => d.dayKey))
  );

  const weeks = useMemo(() => groupByWeeks(days), [days]);

  const selectedDays = days.filter(d => selectedKeys.has(d.dayKey) && d.hours > 0);
  const totalHours = selectedDays.reduce((sum, d) => sum + d.hours, 0);

  const toggleDay = (dayKey: string, hours: number) => {
    if (hours === 0) return;
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const toggleWeek = (weekDays: MonthDay[]) => {
    const withHours = weekDays.filter(d => d.hours > 0);
    if (withHours.length === 0) return;
    const allSelected = withHours.every(d => selectedKeys.has(d.dayKey));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      for (const d of withHours) {
        if (allSelected) next.delete(d.dayKey);
        else next.add(d.dayKey);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const dates = selectedDays.map(d => d.date);
    if (dates.length > 0) onConfirm(dates);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-2xl border border-slate-200 dark:border-slate-600 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
            Limpar Horas — {MONTHS_PT[currentMonth]} {currentYear}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold">x</button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3">
          {weeks.map((week, wi) => {
            const withHours = week.filter(d => d.hours > 0);
            const allSel = withHours.length > 0 && withHours.every(d => selectedKeys.has(d.dayKey));
            return (
              <div key={wi}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Semana {wi + 1}</span>
                  {withHours.length > 0 && (
                    <button onClick={() => toggleWeek(week)} disabled={isSaving}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
                      {allSel ? "Desmarcar" : "Selecionar"}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {week.map(day => {
                    const isSelected = selectedKeys.has(day.dayKey) && day.hours > 0;
                    const hasHours = day.hours > 0;
                    return (
                      <button key={day.dayKey}
                        onClick={() => toggleDay(day.dayKey, day.hours)}
                        disabled={!hasHours || isSaving}
                        className={`rounded-lg border p-2 text-center text-xs transition ${
                          !hasHours ? "bg-slate-100 dark:bg-slate-800 opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700" :
                          isSelected ? "bg-red-100 dark:bg-red-950 border-red-300 dark:border-red-700 cursor-pointer" :
                          "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-60 cursor-pointer"
                        }`}>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {WEEKDAYS_PT[day.weekdayIndex]} {day.dayNumber}
                        </div>
                        {hasHours ? (
                          <div className={`font-medium mt-0.5 ${isSelected ? "text-red-700 dark:text-red-300" : "text-slate-600 dark:text-slate-400"}`}>
                            {formatHours(day.hours)}h
                          </div>
                        ) : (
                          <div className="text-slate-400 dark:text-slate-500 mt-0.5">0h</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress */}
        {progress && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              A apagar dia {progress.current} de {progress.total}...
            </p>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full bg-red-500 transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {/* Warning + Summary + Actions */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          {selectedDays.length > 0 && (
            <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-2">
              <p className="text-xs font-semibold text-red-700 dark:text-red-200">
                Esta acao nao pode ser desfeita.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300 mb-3">
            <span>Dias: <strong>{selectedDays.length}</strong></span>
            <span>Total: <strong>{formatHours(totalHours)}h</strong></span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={isSaving}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleConfirm}
              disabled={isSaving || selectedDays.length === 0}
              className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSaving ? "Apagando..." : `Apagar ${selectedDays.length} dia(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
