"use client";

import { useEffect, useMemo, useState } from "react";

// Types
type Holiday = { name: string; date: Date };
type TodoItem = { id: string; title: string; date: Date; status?: string };
type SelectedDay = {
  date: Date;
  todos: TodoItem[];
  holiday?: Holiday;
  actualHours?: number;
  expectedHours?: number | null;
};
type Recommendation = { taskId: string; taskTitle: string; hours: number };

// Constants
const WEEKDAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const IN_PROGRESS_STATUSES = [
  "em desenvolvimento", "desenvolvido", "in progress", "development", "developed",
];

// Utility Functions
const formatHours = (h: number) => {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${mins.toString().padStart(2, "0")}`;
};

function toKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSummerTime(date: Date): boolean {
  const month = date.getMonth();
  return month >= 2 && month < 9;
}

function getExpectedHours(date: Date, isSummer: boolean): number | null {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;
  return isSummer
    ? (dayOfWeek >= 1 && dayOfWeek <= 4 ? 7 : 9)
    : (dayOfWeek >= 1 && dayOfWeek <= 4 ? 9 : 7);
}

function getHoursStatus(
  actualHours: number | undefined,
  expectedHours: number | null
): "correct" | "missing" | "wrong" | null {
  if (expectedHours === null) return null;
  if (actualHours === undefined) return "missing";
  return actualHours === expectedHours ? "correct" : "wrong";
}

function getHoursStatusColor(status: "correct" | "missing" | "wrong" | null): string {
  if (status === "correct") {
    return "border-green-400 dark:border-green-600 bg-green-100 dark:bg-green-800 hover:bg-green-200 dark:hover:bg-green-700";
  } else if (status === "missing") {
    return "border-red-400 dark:border-red-600 bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700";
  } else if (status === "wrong") {
    return "border-yellow-400 dark:border-yellow-600 bg-yellow-100 dark:bg-yellow-800 hover:bg-yellow-200 dark:hover:bg-yellow-700";
  }
  return "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700";
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthStartOffset(year: number, monthIndex: number) {
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getPortugalHolidays(year: number): Holiday[] {
  const easter = getEasterSunday(year);

  const fixed: Holiday[] = [
    { name: "Ano Novo", date: new Date(year, 0, 1) },
    { name: "Dia da Liberdade", date: new Date(year, 3, 25) },
    { name: "Dia do Trabalhador", date: new Date(year, 4, 1) },
    { name: "Dia de Portugal", date: new Date(year, 5, 10) },
    { name: "Assunção de Nossa Senhora", date: new Date(year, 7, 15) },
    { name: "Implantação da República", date: new Date(year, 9, 5) },
    { name: "Dia de Todos os Santos", date: new Date(year, 10, 1) },
    { name: "Restauração da Independência", date: new Date(year, 11, 1) },
    { name: "Imaculada Conceição", date: new Date(year, 11, 8) },
    { name: "Natal", date: new Date(year, 11, 25) },
  ];

  const movable: Holiday[] = [
    { name: "Carnaval", date: addDays(easter, -47) },
    { name: "Sexta-Feira Santa", date: addDays(easter, -2) },
    { name: "Páscoa", date: addDays(easter, 0) },
    { name: "Corpo de Deus", date: addDays(easter, 60) },
  ];

  return [...fixed, ...movable];
}

type CalendarProps = {
  todoList?: TodoItem[];
  timeEntries?: { [key: string]: number };
  isLoading?: boolean;
  onMonthChange?: () => void;
  authToken?: string | null;
  authUrl?: string;
};

export default function Calendar({ todoList = [], timeEntries = {}, isLoading = false, onMonthChange, authToken, authUrl }: CalendarProps) {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [meetingsTaskId, setMeetingsTaskId] = useState(() => {
    return localStorage.getItem("meetings_task_id") || "4730";
  });
  const [meetingsTask, setMeetingsTask] = useState<TodoItem | null>(null);
  const [showMeetingsInput, setShowMeetingsInput] = useState(false);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState<{
    date: Date;
    recommendations: Recommendation[];
  } | null>(null);
  const [clearHoursModal, setClearHoursModal] = useState<Date | null>(null);

  function showConfirmation(selectedDate: Date, recommendations: Recommendation[]) {
    setConfirmationModal({
      date: selectedDate,
      recommendations,
    });
  }

  useEffect(() => {
    // Auto-show recommendation if selected day has no hours
    if (selectedDay && selectedDay.expectedHours !== null && !selectedDay.actualHours) {
      setShowRecommendation(true);
    }
  }, [selectedDay]);

  useEffect(() => {
    // Load meetings task from OpenProject when ID is configured
    if (meetingsTaskId && authToken && authUrl) {
      const fetchMeetingsTask = async () => {
        try {
          const encodedAuth = btoa(`apikey:${authToken}`);
          const headers = {
            "Authorization": `Basic ${encodedAuth}`,
            "X-OpenProject-URL": authUrl,
          };
          
          console.log("[Calendar] Fetching meetings task", { meetingsTaskId, headers });
          
          const response = await fetch(
            `/api/openproject/get-task?taskId=${meetingsTaskId}`,
            { headers }
          );
          
          console.log("[Calendar] Meetings task response:", response.status, response.statusText);
          
          if (response.ok) {
            const data = await response.json();
            console.log("[Calendar] Meetings task data:", data);
            setMeetingsTask({
              id: data.id.toString(),
              title: data.title,
              date: new Date(),
              status: data.status,
            });
          } else {
            console.error("Erro ao carregar task de meetings:", response.statusText);
          }
        } catch (err) {
          console.error("Erro ao carregar task de meetings:", err);
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
    alert("Task de Meetings guardada!");
  };      

  function calculateHoursRecommendation(
    allDevTasks: TodoItem[],
    dayKey: string,
    expectedHours: number
  ): { text: string; recommendations: Recommendation[] } {
    if (allDevTasks.length === 0) {
      return { text: "Sem tarefas em desenvolvimento neste mês.", recommendations: [] };
    }

    const alreadyRegistered = timeEntries[dayKey] || 0;
    const hoursNeeded = Math.max(0, expectedHours - alreadyRegistered);

    if (hoursNeeded === 0) {
      return { text: "Este dia já tem todas as horas registadas! ✅", recommendations: [] };
    }

    const meetingsTaskAdded = meetingsTaskId && allDevTasks.some(t => t.id === meetingsTaskId);
    const recommendedDetails: Recommendation[] = [];
    let hoursAssigned = 0;

    // Add meetings task
    if (meetingsTask && !meetingsTaskAdded) {
      recommendedDetails.push({
        taskId: meetingsTask.id,
        taskTitle: meetingsTask.title,
        hours: 0.5,
      });
      hoursAssigned += 0.5;
    }

    // Distribute remaining hours
    let taskIndex = 0;
    let attempts = 0;
    const maxAttempts = allDevTasks.length * 15;
    const maxHoursPerTask = 3;

    while (hoursAssigned < hoursNeeded && allDevTasks.length > 0 && attempts < maxAttempts) {
      const task = allDevTasks[taskIndex % allDevTasks.length];
      const remainingHours = hoursNeeded - hoursAssigned;
      const hoursForTask = Math.min(remainingHours, maxHoursPerTask);

      if (!recommendedDetails.some(r => r.taskId === task.id)) {
        recommendedDetails.push({
          taskId: task.id,
          taskTitle: task.title,
          hours: hoursForTask,
        });
        hoursAssigned += hoursForTask;
      }
      taskIndex++;
      attempts++;
    }

    const totalRecommended = recommendedDetails.reduce((sum, t) => sum + t.hours, 0);
    const text = `📊 Recomendação para este dia\n\n` +
      `Registadas: ${formatHours(alreadyRegistered)}\n` +
      `Esperadas: ${formatHours(expectedHours)}\n` +
      `Recomendadas: ${formatHours(totalRecommended)}\n` +
      `Total: ${formatHours(alreadyRegistered + totalRecommended)}\n\n` +
      `Tarefas sugeridas:\n` +
      recommendedDetails.map(t => `• ${t.taskTitle} - ${formatHours(t.hours)}`).join("\n");

    return { text, recommendations: recommendedDetails };
  }

  async function saveRecommendedHours(selectedDate: Date, recommendations: Recommendation[]) {
    if (recommendations.length === 0) {
      alert("Sem horas para guardar!");
      return;
    }

    if (!authToken || !authUrl) {
      alert("Erro: Credenciais não disponíveis!");
      return;
    }

    setIsSavingHours(true);
    try {
      const payload = {
        date: toKey(selectedDate),
        entries: recommendations.map(r => ({
          workPackageId: r.taskId,
          spentTime: r.hours,
        })),
      };
      
      console.log("[Calendar] Saving hours with payload:", payload);
      
      const response = await fetch("/api/openproject/add-time-entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
          "X-OpenProject-URL": authUrl,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Falha ao guardar horas");
      }

      const data = await response.json();
      console.log("[Calendar] Save response:", data);
      
      if (data.saved > 0) {
        let message = `✅ ${data.saved} entrada(s) de tempo adicionada(s) com sucesso!`;
        if (data.errors && data.errors.length > 0) {
          message += `\n\n⚠️ Erros em ${data.errors.length} tarefa(s):\n${data.errors.slice(0, 2).map((e: any) => `• ${e.substring(0, 100)}`).join("\n")}`;
        }
        alert(message);
        
        if (onMonthChange) {
          onMonthChange();
        }
        setSelectedDay(null);
        setShowRecommendation(false);
      } else if (data.errors && data.errors.length > 0) {
        // All entries failed
        throw new Error(`Falha ao guardar: ${data.errors[0]}`);
      } else {
        throw new Error("Nenhuma entrada foi guardada");
      }
    } catch (err) {
      alert(`Erro ao guardar horas: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
    } finally {
      setIsSavingHours(false);
    }
  }

  async function clearHours(dateToDelete: Date) {
    if (!authToken || !authUrl) {
      alert("Erro: Credenciais não disponíveis!");
      return;
    }

    const dateKey = toKey(dateToDelete);
    
    try {
      // Get the time entries for this day from timeEntries object
      const hoursToDelete = timeEntries[dateKey];
      
      if (!hoursToDelete || hoursToDelete === 0) {
        alert("Não existem horas registadas para este dia.");
        setClearHoursModal(null);
        return;
      }

      setIsSavingHours(true);

      const response = await fetch("/api/openproject/clear-time-entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
          "X-OpenProject-URL": authUrl,
        },
        body: JSON.stringify({ date: dateKey }),
      });

      if (!response.ok) {
        throw new Error("Falha ao apagar horas");
      }

      const data = await response.json();
      console.log("[Calendar] Clear response:", data);

      if (data.deleted > 0) {
        alert(`✅ ${data.deleted} entrada(s) de tempo apagada(s) com sucesso!`);

        if (onMonthChange) {
          onMonthChange();
        }
      } else if (data.errors && data.errors.length > 0) {
        // All entries failed
        throw new Error(`Falha ao apagar: ${data.errors[0]}`);
      } else {
        alert("Nenhuma entrada foi apagada");
      }

      setSelectedDay(null);
      setClearHoursModal(null);
    } catch (err) {
      alert(`Erro ao apagar horas: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
    } finally {
      setIsSavingHours(false);
    }
  }

  function goToPreviousMonth() {
    setCurrentMonth(prev => (prev === 0 ? 11 : prev - 1));
    if (currentMonth === 0) setCurrentYear(prev => prev - 1);
    if (onMonthChange) onMonthChange();
  }

  function goToNextMonth() {
    setCurrentMonth(prev => (prev === 11 ? 0 : prev + 1));
    if (currentMonth === 11) setCurrentYear(prev => prev + 1);
    if (onMonthChange) onMonthChange();
  }

  function goToToday() {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    if (onMonthChange) onMonthChange();
  }

  // Memos
  const holidays = useMemo(() => getPortugalHolidays(currentYear), [currentYear]);
  
  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday>();
    holidays.forEach(h => map.set(toKey(h.date), h));
    return map;
  }, [holidays]);

  const todoMap = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    todoList.forEach(todo => {
      const key = toKey(todo.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(todo);
    });
    return map;
  }, [todoList]);

  const monthDevelopmentTasks = useMemo(() => {
    return todoList.filter(todo => {
      const taskDate = todo.date;
      return (
        taskDate.getMonth() === currentMonth &&
        taskDate.getFullYear() === currentYear &&
        todo.status &&
        IN_PROGRESS_STATUSES.some(status =>
          todo?.status?.toLowerCase().includes(status.toLowerCase())
        )
      );
    });
  }, [todoList, currentMonth, currentYear]);

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startOffset = getMonthStartOffset(currentYear, currentMonth);
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToPreviousMonth}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            BACK
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            NEXT
          </button>
          <button
            type="button"
            onClick={goToToday}
            disabled={isLoading}
            className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Hoje
          </button>
        </div>
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-200">
          {isLoading ? (
            <div className="h-6 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          ) : (
            `${MONTHS_PT[currentMonth]} ${currentYear}`
          )}
        </div>
      </div>

      <div className="mb-4 space-y-2">
        <button
          onClick={() => setShowMeetingsInput(!showMeetingsInput)}
          className="w-full rounded-lg bg-slate-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
        >
          ⚙️ Configurar Task de Meetings {meetingsTaskId && `(ID: ${meetingsTaskId})`}
        </button>

        {showMeetingsInput && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              ID da Task de Meetings (0.5h todos os dias)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={meetingsTaskId}
                onChange={(e) => setMeetingsTaskId(e.target.value)}
                placeholder="Ex: 12345"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <button
                onClick={saveMeetingsTask}
                className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600"
              >
                Guardar
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Esta task será automaticamente adicionada com 0.5h em todos os dias úteis na distribuição.
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-slate-500">
        {WEEKDAYS_PT.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-2">
        {isLoading ? (
          // Loading skeleton
          Array.from({ length: 35 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="flex min-h-[80px] flex-col rounded-xl border border-slate-200 bg-slate-100 p-2 dark:border-slate-600 dark:bg-slate-700 animate-pulse"
            >
              <div className="h-4 w-6 rounded bg-slate-300 dark:bg-slate-600" />
              <div className="mt-2 h-3 w-12 rounded bg-slate-300 dark:bg-slate-600" />
              <div className="mt-2 h-2 w-full rounded bg-slate-300 dark:bg-slate-600" />
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
          const isToday =
            isCurrentMonth &&
            dayNumber === today.getDate() &&
            currentMonth === today.getMonth() &&
            currentYear === today.getFullYear();

          // Calculate hours status
          const isSummer = isSummerTime(date);
          const expectedHours = isCurrentMonth && !holiday ? getExpectedHours(date, isSummer) : null;
          const actualHours = isCurrentMonth ? timeEntries[key] : undefined;
          const hoursStatus = isCurrentMonth && !holiday ? getHoursStatus(actualHours, expectedHours) : null;

          const dayBgColor = getHoursStatusColor(hoursStatus);

          return (
            <div
              key={`${currentYear}-${currentMonth}-${index}`}
              onClick={() => {
                if (isCurrentMonth) {
                  setSelectedDay({
                    date,
                    todos: dayTodos,
                    holiday,
                    actualHours,
                    expectedHours,
                  });
                }
              }}
              className={`flex min-h-[80px] flex-col rounded-xl border p-2 text-left text-sm transition cursor-pointer ${
                isCurrentMonth
                  ? `${dayBgColor} text-slate-900 dark:text-slate-100`
                  : "border-transparent bg-transparent text-slate-400"
              } ${isToday ? "ring-2 ring-indigo-400" : ""}`}
            >
              <span className="text-xs font-semibold">
                {isCurrentMonth ? dayNumber : ""}
              </span>
              {holiday && (
                <span className="mt-2 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                  {holiday.name}
                </span>
              )}
              {dayTodos.length > 0 && (
                <div className="mt-2 space-y-1">
                  {dayTodos.map((todo) => (
                    <button
                      key={todo.id}
                      onClick={() => setSelectedTodo(todo)}
                      className="block w-full rounded-md bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900 truncate text-left"
                    >
                      {todo.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
        )}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <p className="font-semibold">Feriados nacionais (Portugal)</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {holidays
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map((holiday) => (
              <li key={holiday.name} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>
                  {holiday.name} — {holiday.date.getDate()} {MONTHS_PT[holiday.date.getMonth()]}
                </span>
              </li>
            ))}
        </ul>
      </div>

      {selectedTodo && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
          onClick={() => setSelectedTodo(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
                {selectedTodo.title}
              </h2>
              <button
                onClick={() => setSelectedTodo(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
              >
                ×
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              {selectedTodo.date.toLocaleDateString("pt-PT")}
            </p>
            {/* Popup content goes here */}
          </div>
        </div>
      )}

      {selectedDay && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
                  {selectedDay.date.toLocaleDateString("pt-PT", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </h2>
                {selectedDay.holiday && (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                    🎉 {selectedDay.holiday.name}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
              >
                ×
              </button>
            </div>

            {selectedDay.todos.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                  Tarefas ({selectedDay.todos.length}):
                </p>
                {selectedDay.todos.map((todo) => (
                  <div
                    key={todo.id}
                    className="rounded-lg bg-blue-50 dark:bg-blue-900 p-3 border border-blue-200 dark:border-blue-700"
                  >
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {todo.title}
                    </p>
                    {todo.status && (
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        Status: {todo.status}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhuma tarefa para este dia
              </p>
            )}

            {selectedDay.expectedHours !== null && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Horas de trabalho:
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-700 p-3 text-center">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Esperadas</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {selectedDay.expectedHours}h
                    </p>
                  </div>
                  <div className="flex-1 rounded-lg bg-slate-100 dark:bg-slate-700 p-3 text-center">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Registradas</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {selectedDay.actualHours || 0}h
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setShowRecommendation(!showRecommendation)}
                  className="mt-3 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
                >
                  {showRecommendation ? "Ocultar Recomendação" : "Adicionar Horas Automaticamente"}
                </button>

                {selectedDay.actualHours !== undefined && selectedDay.actualHours > 0 && (
                  <button
                    onClick={() => setClearHoursModal(selectedDay.date)}
                    disabled={isSavingHours}
                    className="mt-2 w-full rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🗑️ Limpar Horas
                  </button>
                )}

                {showRecommendation && (
                  <div className="mt-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-4">
                    {(() => {
                      const result = calculateHoursRecommendation(
                        monthDevelopmentTasks,
                        toKey(selectedDay.date),
                        selectedDay.expectedHours || 0
                      );
                      return (
                        <>
                          <p className="text-sm text-indigo-900 dark:text-indigo-100 whitespace-pre-line mb-3">
                            {result.text}
                          </p>
                          {result.recommendations.length > 0 && (
                            <button
                              onClick={() => showConfirmation(selectedDay.date, result.recommendations)}
                              disabled={isSavingHours}
                              className="w-full rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isSavingHours ? "Guardando..." : "💾 Guardar Horas"}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {confirmationModal && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
          onClick={() => setConfirmationModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200 mb-2">
              Tem a certeza?
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Quer atualizar as seguintes horas para o dia{" "}
              <strong>
                {confirmationModal.date.toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </strong>
              ?
            </p>

            <div className="mb-6 space-y-2 max-h-64 overflow-y-auto">
              {confirmationModal.recommendations.map((rec) => (
                <div
                  key={rec.taskId}
                  className="flex justify-between rounded-lg bg-slate-100 dark:bg-slate-700 p-2 text-sm"
                >
                  <span className="text-slate-900 dark:text-slate-100">{rec.taskTitle}</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatHours(rec.hours)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between rounded-lg bg-indigo-100 dark:bg-indigo-900 p-2 text-sm font-semibold border-2 border-indigo-300 dark:border-indigo-700">
                <span className="text-indigo-900 dark:text-indigo-100">Total</span>
                <span className="text-indigo-900 dark:text-indigo-100">
                  {formatHours(confirmationModal.recommendations.reduce((sum, r) => sum + r.hours, 0))}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setConfirmationModal(null)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  saveRecommendedHours(
                    confirmationModal.date,
                    confirmationModal.recommendations
                  );
                  setConfirmationModal(null);
                }}
                disabled={isSavingHours}
                className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingHours ? "Guardando..." : "✅ Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {clearHoursModal && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
          onClick={() => setClearHoursModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200 mb-2">
              Tem a certeza?
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Pretende apagar todas as horas registadas para o dia{" "}
              <span className="font-semibold">
                {clearHoursModal.toLocaleDateString("pt-PT", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              ?
            </p>

            <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3">
              <p className="text-sm font-semibold text-red-700 dark:text-red-200">
                ⚠️ Esta ação não pode ser desfeita.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setClearHoursModal(null)}
                disabled={isSavingHours}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  clearHours(clearHoursModal);
                }}
                disabled={isSavingHours}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingHours ? "Apagando..." : "🗑️ Apagar Horas"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}