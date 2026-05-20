"use client";

import type { TodoItem, Holiday, TimeEntriesData, SprintInfo, TaskStatusTimeline, StatusWeightConfig } from "@/types";
import { toKey, getHoursStatus, WEEKDAYS_PT, MONTHS_PT } from "@/lib/calendar-utils";
import DayCell from "./DayCell";

type Props = {
  isLoading: boolean;
  currentYear: number;
  currentMonth: number;
  totalCells: number;
  startOffset: number;
  daysInMonth: number;
  today: Date;
  holidayMap: Map<string, Holiday>;
  todoMap: Map<string, TodoItem[]>;
  sprintDayKeys: Set<string>;
  savingDays: Set<string>;
  timelines: Record<string, TaskStatusTimeline>;
  statusWeights: StatusWeightConfig;
  timeEntries: TimeEntriesData;
  holidays: Holiday[];
  activeSprint: string | null;
  activeSprintInfo: SprintInfo | null;
  taskCount: number;
  getExpectedHours: (date: Date) => number | null;
  onSelectDay: (args: { date: Date; todos: TodoItem[]; holiday?: Holiday; actualHours?: number; expectedHours: number | null }) => void;
  onTodoClick: (todo: TodoItem) => void;
  onClearDay: (date: Date) => void;
};

// The calendar month grid — the "calendar view" body, peer to KanbanBoard.
// Pure presentation: all data + callbacks come from the workspace shell, which
// sources its data from AppDataProvider (single source, no double fetch).
export default function MonthGrid({
  isLoading, currentYear, currentMonth, totalCells, startOffset, daysInMonth, today,
  holidayMap, todoMap, sprintDayKeys, savingDays, timelines, statusWeights, timeEntries,
  holidays, activeSprint, activeSprintInfo, taskCount, getExpectedHours,
  onSelectDay, onTodoClick, onClearDay,
}: Props) {
  return (
    <div className="p-4 md:p-6">
      {/* Sprint info chip */}
      {activeSprintInfo?.startDate && activeSprintInfo?.endDate && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1 text-xs text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
          <span className="font-medium">{activeSprint}</span>
          <span className="text-indigo-400 dark:text-indigo-500">·</span>
          <span>
            {new Date(activeSprintInfo.startDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
            {" — "}
            {new Date(activeSprintInfo.endDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}
          </span>
          <span className="text-indigo-400 dark:text-indigo-500">·</span>
          <span>{taskCount} tarefas</span>
        </div>
      )}

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">
        {WEEKDAYS_PT.map((day) => <div key={day}>{day}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {isLoading ? (
          Array.from({ length: 35 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="flex min-h-22 flex-col rounded-xl border border-slate-200 bg-slate-100 p-2 dark:border-slate-700 dark:bg-slate-800 animate-pulse-soft">
              <div className="h-3 w-5 rounded bg-slate-300 dark:bg-slate-700" />
              <div className="mt-2 h-2 w-10 rounded bg-slate-300 dark:bg-slate-700" />
            </div>
          ))
        ) : (
          Array.from({ length: totalCells }).map((_, index) => {
            const dayNumber = index - startOffset + 1;
            const isCurrentMonth = dayNumber > 0 && dayNumber <= daysInMonth;
            const date = new Date(currentYear, currentMonth, dayNumber);
            const key = toKey(date);
            const holiday = isCurrentMonth ? holidayMap.get(key) : undefined;
            const dayTodos = isCurrentMonth ? todoMap.get(key) || [] : [];
            const isToday = isCurrentMonth && dayNumber === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
            const dow = date.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const expectedHours = isCurrentMonth && !holiday ? getExpectedHours(date) : null;
            const actualHours = isCurrentMonth ? timeEntries.byDay[key] : undefined;
            const hoursStatus = isCurrentMonth && !holiday ? getHoursStatus(actualHours, expectedHours) : null;

            return (
              <DayCell
                key={`${currentYear}-${currentMonth}-${index}`}
                dayNumber={dayNumber}
                isCurrentMonth={isCurrentMonth}
                isToday={isToday}
                isWeekend={isWeekend}
                holiday={holiday}
                todos={dayTodos}
                hoursStatus={hoursStatus}
                hasHours={!!actualHours && actualHours > 0}
                isInSprint={isCurrentMonth && sprintDayKeys.has(key)}
                isSaving={savingDays.has(key)}
                dayKey={key}
                timelines={timelines}
                statusWeights={statusWeights}
                onClick={() => {
                  if (isCurrentMonth) onSelectDay({ date, todos: dayTodos, holiday, actualHours, expectedHours });
                }}
                onTodoClick={onTodoClick}
                onClearDay={() => onClearDay(date)}
              />
            );
          })
        )}
      </div>

      {/* Holidays list */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--surface-1)] p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <p className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">Feriados nacionais (Portugal)</p>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {holidays.sort((a, b) => a.date.getTime() - b.date.getTime()).map((holiday) => (
            <li key={holiday.name} className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>{holiday.name} — {holiday.date.getDate()} {MONTHS_PT[holiday.date.getMonth()]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
