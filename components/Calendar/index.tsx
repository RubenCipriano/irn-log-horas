"use client";

import { useEffect, useMemo, useState } from "react";
import type { TodoItem, Holiday, SelectedDay, Recommendation, TimeEntriesData, SprintInfo } from "@/types";
import { useWorkSchedule } from "@/hooks/useWorkSchedule";
import { useTaskAssignments } from "@/hooks/useTaskAssignments";
import {
  formatHours, toKey, getHoursStatus, getDaysInMonth, getMonthStartOffset,
  WEEKDAYS_PT, MONTHS_PT, IN_PROGRESS_STATUSES,
} from "@/lib/calendar-utils";
import { getPortugalHolidays } from "@/lib/holidays";
import ScheduleSettings from "@/components/ScheduleSettings";
import { useToast } from "@/components/Toast";
import { getActiveTasksForDay } from "@/lib/task-filtering";
import TaskAssignmentModal from "@/components/TaskAssignmentModal";
import DayCell from "./DayCell";
import TaskModal from "./TaskModal";
import ConfirmationModal from "./ConfirmationModal";
import ClearHoursModal from "./ClearHoursModal";
import ClearMonthModal from "./ClearMonthModal";
import QuickHoursForm from "@/components/QuickHoursForm";
import WeekFillModal from "@/components/WeekFillModal";
import MonthFillModal from "@/components/MonthFillModal";

const EMPTY_TIME_ENTRIES: TimeEntriesData = { byDay: {}, byTask: {}, byDayTask: {} };

type CalendarProps = {
  todoList?: TodoItem[];
  timeEntries?: TimeEntriesData;
  sprints?: SprintInfo[];
  isLoading?: boolean;
  onMonthChange?: () => void;
  onTimeEntriesUpdate?: (updater: (prev: TimeEntriesData) => TimeEntriesData) => void;
  authToken?: string | null;
  authUrl?: string;
};

export default function Calendar({ todoList = [], timeEntries = EMPTY_TIME_ENTRIES, sprints = [], isLoading = false, onMonthChange, onTimeEntriesUpdate, authToken, authUrl }: CalendarProps) {
  const today = new Date();
  const { addToast } = useToast();
  const { schedule, saveSchedule, resetSchedule, getExpectedHours } = useWorkSchedule();
  const { assignments, assignTask, unassignTask, getAssignmentsForDay } = useTaskAssignments();
  const [showTaskAssignment, setShowTaskAssignment] = useState(false);
  const [showWeekFill, setShowWeekFill] = useState(false);
  const [showMonthFill, setShowMonthFill] = useState(false);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [meetingsTaskId, setMeetingsTaskId] = useState(() => {
    return localStorage.getItem("meetings_task_id") || "5158";
  });
  const [meetingsTask, setMeetingsTask] = useState<TodoItem | null>(null);
  const [showMeetingsInput, setShowMeetingsInput] = useState(false);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [savingDays, setSavingDays] = useState<Set<string>>(new Set());
  const [confirmationModal, setConfirmationModal] = useState<{
    date: Date;
    recommendations: Recommendation[];
  } | null>(null);
  const [clearHoursModal, setClearHoursModal] = useState<Date | null>(null);
  const [showClearMonth, setShowClearMonth] = useState(false);
  const [clearProgress, setClearProgress] = useState<{ current: number; total: number } | null>(null);
  const [activeSprint, setActiveSprint] = useState<string | null>(() => {
    return localStorage.getItem("active_sprint") || null;
  });

  // Available sprints from tasks
  const availableSprints = useMemo(() => {
    const sprints = new Set<string>();
    todoList.forEach(t => { if (t.sprint) sprints.add(t.sprint); });
    return Array.from(sprints).sort();
  }, [todoList]);

  // Auto-detect sprint on first load
  useEffect(() => {
    if (activeSprint || availableSprints.length === 0) return;
    // Pick sprint with most tasks
    const counts: Record<string, number> = {};
    todoList.forEach(t => { if (t.sprint) counts[t.sprint] = (counts[t.sprint] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) {
      setActiveSprint(best[0]);
      localStorage.setItem("active_sprint", best[0]);
    }
  }, [availableSprints, todoList, activeSprint]);

  // Lock body scroll when any modal is open
  useEffect(() => {
    const anyModalOpen = !!(selectedDay || selectedTodo || confirmationModal || clearHoursModal || showClearMonth || showWeekFill || showMonthFill || showTaskAssignment);
    document.body.style.overflow = anyModalOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selectedDay, selectedTodo, confirmationModal, clearHoursModal, showClearMonth, showWeekFill, showMonthFill, showTaskAssignment]);

  // Auto-show recommendation if selected day has no hours
  useEffect(() => {
    if (selectedDay && selectedDay.expectedHours !== null && !selectedDay.actualHours) {
      setShowRecommendation(true);
    }
  }, [selectedDay]);

  // Load meetings task from OpenProject
  useEffect(() => {
    if (meetingsTaskId && authToken && authUrl) {
      const fetchMeetingsTask = async () => {
        try {
          const encodedAuth = btoa(`apikey:${authToken}`);
          const response = await fetch(
            `/api/openproject/get-task?taskId=${meetingsTaskId}`,
            { headers: { "Authorization": `Basic ${encodedAuth}`, "X-OpenProject-URL": authUrl } }
          );
          if (response.ok) {
            const data = await response.json();
            setMeetingsTask({ id: data.id.toString(), title: data.title, date: new Date(), status: data.status });
          }
        } catch {
          // silently fail
        }
      };
      fetchMeetingsTask();
    } else {
      setMeetingsTask(null);
    }
  }, [meetingsTaskId, authToken, authUrl]);

  const saveMeetingsTask = () => {
    localStorage.setItem("meetings_task_id", meetingsTaskId);
    setShowMeetingsInput(false);
  };

  // --- Optimistic Updates ---
  function optimisticAddHours(dayKey: string, recs: Recommendation[]) {
    onTimeEntriesUpdate?.(prev => {
      const addedHours = recs.reduce((sum, r) => sum + r.hours, 0);
      const newByDay = { ...prev.byDay, [dayKey]: (prev.byDay[dayKey] || 0) + addedHours };
      const newByDayTask = { ...prev.byDayTask, [dayKey]: { ...prev.byDayTask[dayKey] } };
      const newByTask = { ...prev.byTask };
      for (const r of recs) {
        newByDayTask[dayKey][r.taskId] = (newByDayTask[dayKey][r.taskId] || 0) + r.hours;
        if (newByTask[r.taskId]) {
          newByTask[r.taskId] = {
            ...newByTask[r.taskId],
            totalHours: newByTask[r.taskId].totalHours + r.hours,
            entryCount: newByTask[r.taskId].entryCount + 1,
            lastUsed: dayKey > newByTask[r.taskId].lastUsed ? dayKey : newByTask[r.taskId].lastUsed,
          };
        }
      }
      return { byDay: newByDay, byTask: newByTask, byDayTask: newByDayTask };
    });
  }

  function optimisticClearDay(dayKey: string) {
    onTimeEntriesUpdate?.(prev => {
      const newByDay = { ...prev.byDay };
      delete newByDay[dayKey];
      const newByDayTask = { ...prev.byDayTask };
      delete newByDayTask[dayKey];
      return { ...prev, byDay: newByDay, byDayTask: newByDayTask };
    });
  }

  // --- API Actions ---
  async function saveRecommendedHours(selectedDate: Date, recommendations: Recommendation[]) {
    if (!recommendations.length || !authToken || !authUrl) return;
    const dayKey = toKey(selectedDate);
    setIsSavingHours(true);
    setSavingDays(new Set([dayKey]));
    try {
      const response = await fetch("/api/openproject/add-time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
        body: JSON.stringify({
          date: dayKey,
          entries: recommendations.map(r => ({ workPackageId: r.taskId, spentTime: r.hours })),
        }),
      });
      if (!response.ok) throw new Error("Falha ao guardar horas");
      const data = await response.json();
      if (data.saved > 0) {
        optimisticAddHours(dayKey, recommendations);
        addToast(`${data.saved} entrada(s) de tempo adicionada(s) com sucesso!`, "success");
        onMonthChange?.();
        setSelectedDay(null);
        setShowRecommendation(false);
      } else {
        throw new Error(data.errors?.[0] || "Nenhuma entrada foi guardada");
      }
    } catch (err) {
      addToast(`Erro ao guardar horas: ${err instanceof Error ? err.message : "Erro desconhecido"}`, "error");
    } finally {
      setIsSavingHours(false);
      setSavingDays(new Set());
    }
  }

  async function clearHours(dateToDelete: Date) {
    if (!authToken || !authUrl) return;
    const dateKey = toKey(dateToDelete);
    if (!timeEntries.byDay[dateKey]) {
      addToast("Nao existem horas registadas para este dia.", "warning");
      setClearHoursModal(null);
      return;
    }
    setIsSavingHours(true);
    setSavingDays(new Set([dateKey]));
    try {
      const response = await fetch("/api/openproject/clear-time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
        body: JSON.stringify({ date: dateKey }),
      });
      if (!response.ok) throw new Error("Falha ao apagar horas");
      const data = await response.json();
      if (data.deleted > 0) {
        optimisticClearDay(dateKey);
        addToast(`${data.deleted} entrada(s) de tempo apagada(s) com sucesso!`, "success");
        onMonthChange?.();
      }
      if (data.permissionErrors > 0) {
        addToast(`Sem permissao para apagar ${data.permissionErrors} entrada(s).`, "warning");
      }
      setSelectedDay(null);
      setClearHoursModal(null);
    } catch (err) {
      addToast(`Erro ao apagar horas: ${err instanceof Error ? err.message : "Erro desconhecido"}`, "error");
    } finally {
      setIsSavingHours(false);
      setSavingDays(new Set());
    }
  }

  async function saveMultipleDays(dayEntries: { date: Date; recommendations: Recommendation[] }[]) {
    if (!authToken || !authUrl) return;
    const allKeys = new Set(dayEntries.filter(e => e.recommendations.length > 0).map(e => toKey(e.date)));
    setIsSavingHours(true);
    setSavingDays(allKeys);
    let totalSaved = 0;
    const errors: string[] = [];
    try {
      for (const { date, recommendations } of dayEntries) {
        if (recommendations.length === 0) continue;
        const dayKey = toKey(date);
        const response = await fetch("/api/openproject/add-time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
          body: JSON.stringify({
            date: dayKey,
            entries: recommendations.map(r => ({ workPackageId: r.taskId, spentTime: r.hours })),
          }),
        });
        if (response.ok) {
          const data = await response.json();
          totalSaved += data.saved || 0;
          if (data.errors) errors.push(...data.errors);
          if (data.saved > 0) optimisticAddHours(dayKey, recommendations);
        } else {
          errors.push(`${dayKey}: Falha ao guardar`);
        }
        setSavingDays(prev => { const next = new Set(prev); next.delete(dayKey); return next; });
      }
      if (totalSaved > 0) {
        addToast(`${totalSaved} entrada(s) de tempo adicionada(s) em ${dayEntries.length} dia(s)!`, "success");
        onMonthChange?.();
      }
      if (errors.length > 0) {
        addToast(`Erros: ${errors.slice(0, 3).join(", ")}`, "error");
      }
      setShowWeekFill(false);
    } catch (err) {
      addToast(`Erro: ${err instanceof Error ? err.message : "Erro desconhecido"}`, "error");
    } finally {
      setIsSavingHours(false);
      setSavingDays(new Set());
    }
  }

  async function clearMultipleDays(datesToClear: Date[]) {
    if (!authToken || !authUrl) return;
    const allKeys = new Set(datesToClear.map(d => toKey(d)));
    setIsSavingHours(true);
    setSavingDays(allKeys);
    setClearProgress({ current: 0, total: datesToClear.length });
    let totalDeleted = 0;
    let totalPermissionErrors = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < datesToClear.length; i++) {
        const date = datesToClear[i];
        const dateKey = toKey(date);
        setClearProgress({ current: i + 1, total: datesToClear.length });
        if (!timeEntries.byDay[dateKey]) {
          setSavingDays(prev => { const next = new Set(prev); next.delete(dateKey); return next; });
          continue;
        }
        const response = await fetch("/api/openproject/clear-time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
          body: JSON.stringify({ date: dateKey }),
        });
        if (response.ok) {
          const data = await response.json();
          totalDeleted += data.deleted || 0;
          totalPermissionErrors += data.permissionErrors || 0;
          if (data.errors) errors.push(...data.errors);
          if (data.deleted > 0) optimisticClearDay(dateKey);
        } else {
          errors.push(`${dateKey}: Falha ao apagar`);
        }
        setSavingDays(prev => { const next = new Set(prev); next.delete(dateKey); return next; });
      }
      if (totalDeleted > 0) {
        addToast(`${totalDeleted} entrada(s) de tempo apagada(s) em ${datesToClear.length} dia(s)!`, "success");
        onMonthChange?.();
      } else if (errors.length === 0 && totalPermissionErrors === 0) {
        addToast("Nenhuma hora encontrada para apagar.", "warning");
      }
      if (totalPermissionErrors > 0) {
        addToast(`Sem permissao para apagar ${totalPermissionErrors} entrada(s).`, "warning");
      }
      if (errors.length > 0) {
        addToast(`Erros: ${errors.slice(0, 3).join(", ")}`, "error");
      }
      setShowClearMonth(false);
      setSelectedDay(null);
    } catch (err) {
      addToast(`Erro: ${err instanceof Error ? err.message : "Erro desconhecido"}`, "error");
    } finally {
      setIsSavingHours(false);
      setSavingDays(new Set());
      setClearProgress(null);
    }
  }

  // --- Navigation ---
  function goToPreviousMonth() {
    setCurrentMonth(prev => (prev === 0 ? 11 : prev - 1));
    if (currentMonth === 0) setCurrentYear(prev => prev - 1);
    onMonthChange?.();
  }
  function goToNextMonth() {
    setCurrentMonth(prev => (prev === 11 ? 0 : prev + 1));
    if (currentMonth === 11) setCurrentYear(prev => prev + 1);
    onMonthChange?.();
  }
  function goToToday() {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    onMonthChange?.();
  }

  // --- Memos ---
  const holidays = useMemo(() => getPortugalHolidays(currentYear), [currentYear]);
  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday>();
    holidays.forEach(h => map.set(toKey(h.date), h));
    return map;
  }, [holidays]);

  const todoMap = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    todoList.forEach(todo => {
      if (!todo.date || isNaN(todo.date.getTime())) return;
      const key = toKey(todo.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(todo);
    });
    for (const [dayKey, dayAssignments] of Object.entries(assignments)) {
      if (!map.has(dayKey)) map.set(dayKey, []);
      const existing = map.get(dayKey)!;
      for (const assignment of dayAssignments) {
        if (!existing.some(t => t.id === assignment.taskId)) {
          const fullTask = todoList.find(t => t.id === assignment.taskId);
          existing.push(fullTask || { id: assignment.taskId, title: assignment.taskTitle, date: null, status: "pinned" });
        }
      }
    }
    return map;
  }, [todoList, assignments]);

  const monthDevelopmentTasks = useMemo(() => {
    return todoList.filter(todo => {
      // Must have valid in-progress status
      if (!todo.status || !IN_PROGRESS_STATUSES.some(s => todo.status!.toLowerCase().includes(s.toLowerCase()))) return false;
      // Exclude closed
      if (todo.isClosed) return false;
      // Filter by sprint if active
      if (activeSprint && todo.sprint) return todo.sprint === activeSprint;
      // If no sprint filter or task has no sprint, filter by month
      if (todo.updatedAt) {
        const updated = new Date(todo.updatedAt);
        return updated.getMonth() === currentMonth && updated.getFullYear() === currentYear;
      }
      return true;
    });
  }, [todoList, activeSprint, currentMonth, currentYear]);

  const activeSprintInfo = useMemo(() => {
    if (!activeSprint) return null;
    return sprints.find(s => s.name === activeSprint) || null;
  }, [activeSprint, sprints]);

  const sprintDayKeys = useMemo(() => {
    if (!activeSprintInfo?.startDate || !activeSprintInfo?.endDate) return new Set<string>();
    const keys = new Set<string>();
    const start = new Date(activeSprintInfo.startDate + "T00:00:00");
    const end = new Date(activeSprintInfo.endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      keys.add(toKey(d));
    }
    return keys;
  }, [activeSprintInfo]);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startOffset = getMonthStartOffset(currentYear, currentMonth);
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  // --- Render ---
  return (
    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goToPreviousMonth} disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">
            BACK
          </button>
          <button type="button" onClick={goToNextMonth} disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">
            NEXT
          </button>
          <button type="button" onClick={goToToday} disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">
            Hoje
          </button>
          <button type="button" onClick={() => setShowWeekFill(true)} disabled={isLoading}
            className="rounded-lg bg-indigo-500 px-3 py-1 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Semana
          </button>
          <button type="button" onClick={() => setShowMonthFill(true)} disabled={isLoading}
            className="rounded-lg bg-purple-500 px-3 py-1 text-sm font-medium text-white transition hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Mes
          </button>
          <button type="button" onClick={() => setShowClearMonth(true)} disabled={isLoading}
            className="rounded-lg bg-red-500 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Limpar Horas
          </button>
        </div>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-200">
          {isLoading ? <div className="h-6 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" /> : `${MONTHS_PT[currentMonth]} ${currentYear}`}
        </div>
      </div>

      {/* Sprint filter */}
      {availableSprints.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Sprint:</label>
          <select
            value={activeSprint || ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setActiveSprint(val);
              if (val) localStorage.setItem("active_sprint", val);
              else localStorage.removeItem("active_sprint");
            }}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Todas</option>
            {availableSprints.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {activeSprintInfo?.startDate && activeSprintInfo?.endDate && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ({new Date(activeSprintInfo.startDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })} - {new Date(activeSprintInfo.endDate + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" })})
            </span>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ({monthDevelopmentTasks.length} tarefas)
          </span>
        </div>
      )}

      {/* Settings */}
      <div className="mb-4 space-y-2">
        <button onClick={() => setShowMeetingsInput(!showMeetingsInput)}
          className="w-full rounded-lg bg-slate-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600">
          Configurar Task de Meetings {meetingsTaskId && `(ID: ${meetingsTaskId})`}
        </button>
        {showMeetingsInput && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              ID da Task de Meetings (0.5h todos os dias)
            </label>
            <div className="flex gap-2">
              <input type="text" value={meetingsTaskId} onChange={(e) => setMeetingsTaskId(e.target.value)} placeholder="Ex: 12345"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
              <button onClick={saveMeetingsTask} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600">Guardar</button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Esta task sera automaticamente adicionada com 0.5h em todos os dias uteis na distribuicao.
            </p>
          </div>
        )}
        <ScheduleSettings schedule={schedule} onSave={saveSchedule} onReset={resetSchedule} />
      </div>

      {/* Weekday headers */}
      <div className="mt-6 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-slate-500">
        {WEEKDAYS_PT.map((day) => <div key={day}>{day}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="mt-3 grid grid-cols-7 gap-2">
        {isLoading ? (
          Array.from({ length: 35 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="flex min-h-20 flex-col rounded-xl border border-slate-200 bg-slate-100 p-2 dark:border-slate-600 dark:bg-slate-700 animate-pulse">
              <div className="h-4 w-6 rounded bg-slate-300 dark:bg-slate-600" />
              <div className="mt-2 h-3 w-12 rounded bg-slate-300 dark:bg-slate-600" />
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
            const expectedHours = isCurrentMonth && !holiday ? getExpectedHours(date) : null;
            const actualHours = isCurrentMonth ? timeEntries.byDay[key] : undefined;
            const hoursStatus = isCurrentMonth && !holiday ? getHoursStatus(actualHours, expectedHours) : null;

            return (
              <DayCell
                key={`${currentYear}-${currentMonth}-${index}`}
                dayNumber={dayNumber}
                isCurrentMonth={isCurrentMonth}
                isToday={isToday}
                holiday={holiday}
                todos={dayTodos}
                hoursStatus={hoursStatus}
                hasHours={!!actualHours && actualHours > 0}
                isInSprint={isCurrentMonth && sprintDayKeys.has(key)}
                isSaving={savingDays.has(key)}
                onClick={() => {
                  if (isCurrentMonth) setSelectedDay({ date, todos: dayTodos, holiday, actualHours, expectedHours });
                }}
                onTodoClick={setSelectedTodo}
                onClearDay={() => setClearHoursModal(date)}
              />
            );
          })
        )}
      </div>

      {/* Holidays list */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <p className="font-semibold">Feriados nacionais (Portugal)</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {holidays.sort((a, b) => a.date.getTime() - b.date.getTime()).map((holiday) => (
            <li key={holiday.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>{holiday.name} — {holiday.date.getDate()} {MONTHS_PT[holiday.date.getMonth()]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Task detail modal */}
      {selectedTodo && <TaskModal todo={selectedTodo} onClose={() => setSelectedTodo(null)} />}

      {/* Day detail modal */}
      {selectedDay && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4" onClick={() => setSelectedDay(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
                  {selectedDay.date.toLocaleDateString("pt-PT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                </h2>
                {selectedDay.holiday && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">{selectedDay.holiday.name}</p>
                )}
              </div>
              <button onClick={() => setSelectedDay(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold">x</button>
            </div>

            {selectedDay.todos.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Tarefas ({selectedDay.todos.length}):</p>
                {selectedDay.todos.map((todo) => (
                  <div key={todo.id} className="rounded-lg bg-blue-50 dark:bg-blue-900 p-3 border border-blue-200 dark:border-blue-700">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">{todo.title}</p>
                    {todo.status && <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Status: {todo.status}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma tarefa para este dia</p>
            )}

            {/* Tarefas trabalhadas (horas registadas por tarefa) */}
            {timeEntries.byDayTask[toKey(selectedDay.date)] && Object.keys(timeEntries.byDayTask[toKey(selectedDay.date)]).length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tarefas trabalhadas:</p>
                <div className="space-y-1">
                  {Object.entries(timeEntries.byDayTask[toKey(selectedDay.date)]).map(([taskId, hours]) => {
                    const task = todoList.find(t => t.id === taskId);
                    return (
                      <div key={taskId} className="flex justify-between rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 p-2 text-sm">
                        <span className="text-emerald-900 dark:text-emerald-100 truncate flex-1 mr-2">{task?.title || `Task #${taskId}`}</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">{formatHours(hours)}h</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button onClick={() => setShowTaskAssignment(true)}
              className="mt-3 w-full rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 transition hover:bg-indigo-100 dark:hover:bg-indigo-900">
              + Atribuir Tarefas
            </button>

            {selectedDay.expectedHours !== null && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Horas de trabalho:</p>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-700 p-3 text-center">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Esperadas</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{selectedDay.expectedHours}h</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-700 p-3 text-center">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Registadas</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{selectedDay.actualHours || 0}h</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button onClick={() => setShowRecommendation(!showRecommendation)}
                    className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600">
                    {showRecommendation ? "Ocultar" : "Recomendacoes"}
                  </button>
                  {selectedDay.actualHours !== undefined && selectedDay.actualHours > 0 && (
                    <button onClick={() => setClearHoursModal(selectedDay.date)} disabled={isSavingHours}
                      className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed">
                      Limpar
                    </button>
                  )}
                </div>

                <button
                  onClick={() => { setSelectedDay(null); setShowClearMonth(true); }}
                  disabled={isSavingHours}
                  className="mt-2 w-full rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition hover:bg-red-100 dark:hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Limpar Horas
                </button>

                {showRecommendation && (
                  <QuickHoursForm
                    allTasks={getActiveTasksForDay(monthDevelopmentTasks, toKey(selectedDay.date))}
                    pinnedTaskIds={getAssignmentsForDay(toKey(selectedDay.date)).map(a => a.taskId)}
                    taskHistory={timeEntries.byTask}
                    expectedHours={selectedDay.expectedHours || 0}
                    actualHours={selectedDay.actualHours || 0}
                    meetingsTask={meetingsTask}
                    meetingsTaskId={meetingsTaskId}
                    isSaving={isSavingHours}
                    onSave={(recs) => setConfirmationModal({ date: selectedDay.date, recommendations: recs })}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmationModal && (
        <ConfirmationModal
          date={confirmationModal.date}
          recommendations={confirmationModal.recommendations}
          isSaving={isSavingHours}
          onUpdateHours={(idx, hours) => {
            setConfirmationModal(prev => {
              if (!prev) return prev;
              const updated = [...prev.recommendations];
              updated[idx] = { ...updated[idx], hours };
              return { ...prev, recommendations: updated };
            });
          }}
          onConfirm={() => {
            const filtered = confirmationModal.recommendations.filter(r => r.hours > 0);
            if (filtered.length > 0) saveRecommendedHours(confirmationModal.date, filtered);
            setConfirmationModal(null);
          }}
          onCancel={() => setConfirmationModal(null)}
        />
      )}

      {/* Clear hours modal */}
      {clearHoursModal && (
        <ClearHoursModal
          date={clearHoursModal}
          isSaving={isSavingHours}
          onConfirm={() => clearHours(clearHoursModal)}
          onCancel={() => setClearHoursModal(null)}
        />
      )}

      {/* Clear week modal */}
      {showClearMonth && (
        <ClearMonthModal
          currentYear={currentYear}
          currentMonth={currentMonth}
          timeEntries={timeEntries}
          isHoliday={(dayKey: string) => holidayMap.has(dayKey)}
          isSaving={isSavingHours}
          progress={clearProgress}
          onConfirm={(dates: Date[]) => clearMultipleDays(dates)}
          onClose={() => setShowClearMonth(false)}
        />
      )}

      {/* Task assignment modal */}
      {showTaskAssignment && selectedDay && (
        <TaskAssignmentModal
          dayLabel={selectedDay.date.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })}
          allTasks={monthDevelopmentTasks}
          assignedTaskIds={getAssignmentsForDay(toKey(selectedDay.date)).map(a => a.taskId)}
          onAssign={(taskId, taskTitle) => assignTask(taskId, taskTitle, toKey(selectedDay.date))}
          onUnassign={(taskId) => unassignTask(taskId, toKey(selectedDay.date))}
          onClose={() => setShowTaskAssignment(false)}
        />
      )}

      {/* Week fill modal */}
      {showWeekFill && (
        <WeekFillModal
          currentYear={currentYear}
          currentMonth={currentMonth}
          today={today}
          timeEntries={timeEntries}
          allTasks={monthDevelopmentTasks}
          pinnedTaskIds={[]}
          meetingsTask={meetingsTask}
          meetingsTaskId={meetingsTaskId}
          getExpectedHours={getExpectedHours}
          isHoliday={(dayKey) => holidayMap.has(dayKey)}
          isSaving={isSavingHours}
          onSave={saveMultipleDays}
          onClose={() => setShowWeekFill(false)}
        />
      )}

      {showMonthFill && (
        <MonthFillModal
          currentYear={currentYear}
          currentMonth={currentMonth}
          timeEntries={timeEntries}
          allTasks={monthDevelopmentTasks}
          meetingsTask={meetingsTask}
          meetingsTaskId={meetingsTaskId}
          getExpectedHours={getExpectedHours}
          isHoliday={(dayKey) => holidayMap.has(dayKey)}
          isSaving={isSavingHours}
          onSave={(entries) => { saveMultipleDays(entries); setShowMonthFill(false); }}
          onClose={() => setShowMonthFill(false)}
        />
      )}
    </div>
  );
}
