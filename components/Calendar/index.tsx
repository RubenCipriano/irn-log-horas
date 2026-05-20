"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TodoItem, Holiday, SelectedDay, Recommendation, TimeEntriesData, SprintInfo, TaskStatusTimeline, AIDistributionItem, AIUpdateStatusAction, AvailableStatus } from "@/types";
import { useWorkSchedule } from "@/hooks/useWorkSchedule";
import { useTaskAssignments } from "@/hooks/useTaskAssignments";
import { useStatusWeights } from "@/hooks/useStatusWeights";
import { useKanbanColumns } from "@/hooks/useKanbanColumns";
import { useAIProvider } from "@/hooks/useAIProvider";
import { useGitLabConfig } from "@/hooks/useGitLabConfig";
import { useGitLabActivityCheck } from "@/hooks/useGitLabActivityCheck";
import { useDayGitLabActivity } from "@/hooks/useDayGitLabActivity";
import { useAISafetyMode } from "@/hooks/useAISafetyMode";
import { useAuditLog } from "@/hooks/useAuditLog";
import GitLabActivityList from "@/components/GitLabActivityList";
import { useTimelineInference } from "@/hooks/useTimelineInference";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/hooks/useTheme";
import {
  formatHours, toKey, getDaysInMonth, getMonthStartOffset,
} from "@/lib/calendar-utils";
import { getPortugalHolidays } from "@/lib/holidays";
import { getStatusWeightForDay } from "@/lib/status-timeline";
import { useToast } from "@/components/Toast";
import TaskAssignmentModal from "@/components/TaskAssignmentModal";
import MonthGrid from "./MonthGrid";
import TaskModal from "./TaskModal";
import ConfirmationModal from "./ConfirmationModal";
import ClearHoursModal from "./ClearHoursModal";
import ClearMonthModal from "./ClearMonthModal";
import WeekFillModal from "@/components/WeekFillModal";
import MonthFillModal from "@/components/MonthFillModal";
import AppShell from "@/components/Layout/AppShell";
import Sidebar from "@/components/Layout/Sidebar";
import TopBar from "@/components/Layout/TopBar";
import SettingsDrawer from "@/components/Layout/SettingsDrawer";
import CommandPalette from "@/components/CommandPalette";
import AISettings from "@/components/AISettings";
import AIPreviewModal from "@/components/AIPreviewModal";
import GitLabSettings from "@/components/GitLabSettings";
import TimelineInferenceSettings from "@/components/TimelineInferenceSettings";
import KanbanColumnsSettings from "@/components/KanbanColumnsSettings";
import KanbanBoard from "@/components/Kanban/Board";
import ModalCloseButton from "@/components/ModalCloseButton";

const EMPTY_TIME_ENTRIES: TimeEntriesData = { byDay: {}, byTask: {}, byDayTask: {} };

type CalendarProps = {
  todoList?: TodoItem[];
  timeEntries?: TimeEntriesData;
  sprints?: SprintInfo[];
  availableStatuses?: AvailableStatus[];
  isLoading?: boolean;
  onMonthChange?: () => void;
  onTimeEntriesUpdate?: (updater: (prev: TimeEntriesData) => TimeEntriesData) => void;
  onTodosUpdate?: (updater: (prev: TodoItem[]) => TodoItem[]) => void;
  authToken?: string | null;
  authUrl?: string;
  userName?: string;
  userEmail?: string;
  onLogout?: () => void;
  initialView?: "calendar" | "kanban";
};

export default function Calendar({
  todoList = [], timeEntries = EMPTY_TIME_ENTRIES, sprints = [], availableStatuses = [], isLoading = false,
  onMonthChange, onTimeEntriesUpdate, onTodosUpdate, authToken, authUrl,
  userName, userEmail, onLogout, initialView = "calendar",
}: CalendarProps) {
  const today = new Date();
  const router = useRouter();
  const { addToast } = useToast();
  const { schedule, saveSchedule, resetSchedule, getExpectedHours } = useWorkSchedule();
  const { assignments, assignTask, unassignTask, getAssignmentsForDay } = useTaskAssignments();
  const { weights: statusWeights, overrides: weightOverrides, setWeight, resetWeight, reset: resetAllWeights } = useStatusWeights();
  const { toggleVisible: toggleKanbanVisible, moveColumn: moveKanbanColumn, reset: resetKanbanColumns, sync: syncKanban, merge: mergeKanban } = useKanbanColumns();

  // Keep the stored Kanban config in sync with the freshest availableStatuses
  // (new statuses appear visible-by-default, removed ones disappear from the list).
  useEffect(() => {
    if (availableStatuses.length > 0) syncKanban(availableStatuses);
  }, [availableStatuses, syncKanban]);
  const kanbanColumns = useMemo(() => mergeKanban(availableStatuses), [mergeKanban, availableStatuses]);
  const { config: aiConfig, setConfig: setAiConfig, clear: clearAiConfig } = useAIProvider();
  const { config: gitlabConfig, setConfig: setGitlabConfig, clear: clearGitlabConfig } = useGitLabConfig();
  const gitlabCheck = useGitLabActivityCheck(gitlabConfig);
  const dayGitLab = useDayGitLabActivity(gitlabConfig);
  const [showDayGitLab, setShowDayGitLab] = useState(false);
  // Manual per-task hours the user enters in the day modal (taskId -> hours).
  const [dayManualHours, setDayManualHours] = useState<Record<string, number>>({});
  // In-progress edits to already-registered hours (taskId -> string value).
  const [loggedEdits, setLoggedEdits] = useState<Record<string, string>>({});
  const safetyMode = useAISafetyMode();
  const auditLog = useAuditLog();
  // Phase 12 — safety mode "understand-first" overlay. Holds the interpretation
  // returned by the small AI call before the full plan request fires.
  const [safetyInterp, setSafetyInterp] = useState<{ interpretation: string; description: string; range: "day" | "week" | "month" } | null>(null);
  const { config: inferenceConfig, setConfig: setInferenceConfig, reset: resetInference } = useTimelineInference();
  const { theme, setTheme, cycle: cycleTheme } = useTheme();

  // The view is route-driven: / = calendar, /kanban = kanban. `initialView`
  // seeds it from the page; toggling navigates between the two routes (the
  // shared (app) layout keeps the data, so there's no refetch).
  const [view, setViewState] = useState<"calendar" | "kanban">(initialView);
  const setView = (v: "calendar" | "kanban") => {
    if (v === view) return;
    setViewState(v); // instant feedback before navigation completes
    try { localStorage.setItem("view_mode_v1", v); } catch { /* ignore */ }
    router.push(v === "kanban" ? "/kanban" : "/");
  };

  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar_collapsed_v1") === "1";
  });
  const setSidebarCollapsed = (v: boolean) => {
    setSidebarCollapsedState(v);
    try { localStorage.setItem("sidebar_collapsed_v1", v ? "1" : "0"); } catch { /* ignore */ }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteProcessing, setPaletteProcessing] = useState(false);
  const [palettePrefill, setPalettePrefill] = useState<string>("");
  const [paletteRange, setPaletteRange] = useState<"day" | "week" | "month">("week");
  const [paletteAnchorDate, setPaletteAnchorDate] = useState<Date | null>(null);
  // Tracks when the OpenProject task list was last fetched so we can auto-refresh
  // before the user runs the IA. Initialised here so first-open-after-login refreshes.
  const lastTasksFetchedAtRef = useRef<number>(0);
  // Reactive timestamp surfaced in the palette so the user sees how fresh the data is.
  const [lastTasksFetchedDisplay, setLastTasksFetchedDisplay] = useState<number>(0);

  // Open the palette and, if the task list looks stale (>60s old), trigger a
  // background refresh so the IA never works against out-of-date assignees.
  const openPalette = (resetAnchor: boolean) => {
    if (resetAnchor) {
      setPaletteAnchorDate(null);
      setPaletteRange("week");
    }
    const stale = Date.now() - lastTasksFetchedAtRef.current > 60_000;
    if (stale && onMonthChange) {
      onMonthChange();
      lastTasksFetchedAtRef.current = Date.now();
      setLastTasksFetchedDisplay(lastTasksFetchedAtRef.current);
    }
    setPaletteOpen(true);
  };
  const paletteAbortRef = useRef<AbortController | null>(null);
  const [paletteStage, setPaletteStage] = useState<"idle" | "gitlab" | "ai" | "parse">("idle");
  const [paletteDetail, setPaletteDetail] = useState<string>("");
  const [paletteStartedAt, setPaletteStartedAt] = useState<number | null>(null);
  const [aiPreview, setAiPreview] = useState<AIDistributionItem[] | null>(null);
  const [aiReasoning, setAiReasoning] = useState<string | undefined>(undefined);
  const [aiWarnings, setAiWarnings] = useState<string[] | undefined>(undefined);
  const [aiRawResponse, setAiRawResponse] = useState<string | undefined>(undefined);
  const [aiGitlabSummary, setAiGitlabSummary] = useState<{ commits: number; mrs: number; matchedById: number; matchedByFuzzy: number; unmatched: number } | undefined>(undefined);
  const [aiUnmatched, setAiUnmatched] = useState<Array<{ type: "commit" | "merge_request"; title: string; project: string; createdAt: string; refIds: string[]; url: string }> | undefined>(undefined);
  const [aiGitlabActivities, setAiGitlabActivities] = useState<Array<{ type: "commit" | "merge_request"; title: string; project: string; createdAt: string; refIds: string[]; url: string }> | undefined>(undefined);
  const [aiLastDescription, setAiLastDescription] = useState<string>("");
  const [aiLastRange, setAiLastRange] = useState<"day" | "week" | "month">("week");
  const [aiDebug, setAiDebug] = useState<{ promptSystem: string; promptUser: string; dateRange: { from: string; to: string }; tasksSent: number; gitlabActivitySent: number } | undefined>(undefined);
  // Phase 12 — status-change actions proposed by the AI alongside log_hours.
  const [aiStatusActions, setAiStatusActions] = useState<AIUpdateStatusAction[] | undefined>(undefined);

  const [showTaskAssignment, setShowTaskAssignment] = useState(false);
  const [showWeekFill, setShowWeekFill] = useState(false);
  const [showMonthFill, setShowMonthFill] = useState(false);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [meetingsTaskId, setMeetingsTaskId] = useState(() => localStorage.getItem("meetings_task_id") || "5158");
  const [meetingsHours, setMeetingsHoursState] = useState<number>(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("meetings_hours_v1") : null;
    const parsed = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.5;
  });
  const setMeetingsHours = (h: number) => {
    const clamped = Math.max(0, Math.min(8, Math.round(h * 2) / 2));
    setMeetingsHoursState(clamped);
    try { localStorage.setItem("meetings_hours_v1", String(clamped)); } catch { /* ignore */ }
  };
  const [meetingsTask, setMeetingsTask] = useState<TodoItem | null>(null);
  const [isSavingHours, setIsSavingHours] = useState(false);
  const [savingDays, setSavingDays] = useState<Set<string>>(new Set());

  // Refresh the freshness timestamp whenever the task list is updated upstream
  // (login, manual reload, palette-triggered auto-refresh, etc.).
  useEffect(() => {
    lastTasksFetchedAtRef.current = Date.now();
    setLastTasksFetchedDisplay(lastTasksFetchedAtRef.current);
  }, [todoList]);
  const [confirmationModal, setConfirmationModal] = useState<{
    date: Date;
    recommendations: Recommendation[];
  } | null>(null);
  const [clearHoursModal, setClearHoursModal] = useState<Date | null>(null);
  const [showClearMonth, setShowClearMonth] = useState(false);
  const [clearProgress, setClearProgress] = useState<{ current: number; total: number } | null>(null);
  const [activeSprint, setActiveSprint] = useState<string | null>(() => localStorage.getItem("active_sprint") || null);

  // Available sprints from tasks
  const availableSprints = useMemo(() => {
    const set = new Set<string>();
    todoList.forEach(t => { if (t.sprint) set.add(t.sprint); });
    return Array.from(set).sort();
  }, [todoList]);

  // Auto-detect sprint on first load
  useEffect(() => {
    if (activeSprint || availableSprints.length === 0) return;
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
    const anyModalOpen = !!(selectedDay || selectedTodo || confirmationModal || clearHoursModal || showClearMonth || showWeekFill || showMonthFill || showTaskAssignment || settingsOpen || paletteOpen || aiPreview);
    document.body.style.overflow = anyModalOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selectedDay, selectedTodo, confirmationModal, clearHoursModal, showClearMonth, showWeekFill, showMonthFill, showTaskAssignment, settingsOpen, paletteOpen, aiPreview]);

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
    addToast("Task de meetings atualizada.", "success");
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

  // Set (or remove, when newHours <= 0) the logged hours for a single task on a
  // day, adjusting the day total accordingly. Used by the inline edit/remove of
  // already-registered hours in the day modal.
  function optimisticSetTaskHours(dayKey: string, taskId: string, newHours: number) {
    onTimeEntriesUpdate?.(prev => {
      const old = prev.byDayTask[dayKey]?.[taskId] || 0;
      const delta = newHours - old;
      const newByDay = { ...prev.byDay, [dayKey]: Math.max(0, (prev.byDay[dayKey] || 0) + delta) };
      if (newByDay[dayKey] <= 0) delete newByDay[dayKey];
      const newByDayTask = { ...prev.byDayTask, [dayKey]: { ...prev.byDayTask[dayKey] } };
      if (newHours <= 0) delete newByDayTask[dayKey][taskId];
      else newByDayTask[dayKey][taskId] = newHours;
      if (Object.keys(newByDayTask[dayKey]).length === 0) delete newByDayTask[dayKey];
      return { ...prev, byDay: newByDay, byDayTask: newByDayTask };
    });
  }

  // Delete a single task's logged hours for a day (scoped clear).
  async function clearTaskHours(dateToEdit: Date, taskId: string) {
    if (!authToken || !authUrl) return false;
    const dayKey = toKey(dateToEdit);
    const response = await fetch("/api/openproject/clear-time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
      body: JSON.stringify({ date: dayKey, taskId }),
    });
    return response.ok;
  }

  async function removeLoggedTask(dateToEdit: Date, taskId: string) {
    setIsSavingHours(true);
    try {
      const ok = await clearTaskHours(dateToEdit, taskId);
      if (ok) {
        optimisticSetTaskHours(toKey(dateToEdit), taskId, 0);
        addToast("Horas removidas.", "success");
      } else {
        addToast("Falha ao remover horas.", "error");
      }
    } catch {
      addToast("Erro de rede ao remover horas.", "error");
    } finally {
      setIsSavingHours(false);
    }
  }

  // Replace a task's logged hours for a day: clear its entries, then add the
  // new amount (OpenProject has no in-place edit, so it's delete + re-create).
  async function editLoggedTask(dateToEdit: Date, taskId: string, taskTitle: string, newHours: number) {
    if (!authToken || !authUrl) return;
    if (newHours <= 0) { await removeLoggedTask(dateToEdit, taskId); return; }
    const dayKey = toKey(dateToEdit);
    setIsSavingHours(true);
    try {
      const cleared = await clearTaskHours(dateToEdit, taskId);
      if (!cleared) { addToast("Falha ao atualizar horas.", "error"); return; }
      const response = await fetch("/api/openproject/add-time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
        body: JSON.stringify({ date: dayKey, entries: [{ workPackageId: taskId, spentTime: newHours }] }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.saved > 0) {
        optimisticSetTaskHours(dayKey, taskId, newHours);
        addToast(`Horas de "${taskTitle}" atualizadas para ${formatHours(newHours)}h.`, "success");
      } else {
        addToast("Falha ao atualizar horas.", "error");
      }
    } catch {
      addToast("Erro de rede ao atualizar horas.", "error");
    } finally {
      setIsSavingHours(false);
    }
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
        // Optimistic update already reflects the new hours — no full reload.
        setSelectedDay(null);
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
        // Optimistic update already cleared the day locally — no full reload.
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
        // Optimistic updates already reflect the saved hours — no full reload.
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
        // Optimistic updates already cleared the days locally — no full reload.
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

  // Calendar-display list: scoped to the active sprint / current month so the
  // grid + fill modals stay focused. Only "fechado"/"closed" is terminal.
  const monthDevelopmentTasks = useMemo(() => {
    return todoList.filter(todo => {
      // Phase 10 semantic: only "fechado"/"closed" is truly terminal.
      // Everything else (MR para DEV, On hold, Bloqueado, Rejeitado, Desenvolvido, etc.)
      // can still receive hours and must be visible to the AI / fill modals.
      if (todo.isClosed) return false;
      const lower = (todo.status || "").toLowerCase();
      if (lower.includes("fechado") || lower.includes("closed")) return false;
      if (activeSprint && todo.sprint) return todo.sprint === activeSprint;
      if (todo.updatedAt) {
        const updated = new Date(todo.updatedAt);
        return updated.getMonth() === currentMonth && updated.getFullYear() === currentYear;
      }
      return true;
    });
  }, [todoList, activeSprint, currentMonth, currentYear]);

  // AI candidate list: EVERY non-closed task, independent of sprint/month.
  // The user wants the assistant to consider all open work (e.g. a task in
  // another sprint that they touched today via GitLab), not just the scoped
  // calendar view. The orchestrator ranks + caps this list itself.
  const aiCandidateTasks = useMemo(() => {
    return todoList.filter(todo => {
      if (todo.isClosed) return false;
      const lower = (todo.status || "").toLowerCase();
      return !lower.includes("fechado") && !lower.includes("closed");
    });
  }, [todoList]);

  const timelines = useMemo<Record<string, TaskStatusTimeline>>(() => {
    const map: Record<string, TaskStatusTimeline> = {};
    for (const t of todoList) {
      if (t.timeline) map[t.id] = t.timeline;
    }
    return map;
  }, [todoList]);

  const allPinnedIds = useMemo(() => {
    const set = new Set<string>();
    for (const dayAssignments of Object.values(assignments)) {
      for (const a of dayAssignments) set.add(a.taskId);
    }
    return Array.from(set);
  }, [assignments]);

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

  // --- AI command palette flow ---
  async function handlePaletteSubmit(description: string, range: "day" | "week" | "month", opts?: { skipSafety?: boolean }) {
    if (!aiConfig) {
      setPaletteOpen(false);
      setSettingsOpen(true);
      return;
    }

    // Phase 12 — understand-first safety step. Short-circuit on the first call
    // when safety mode is ON; the user approves via the SafetyConfirmModal,
    // which then re-invokes handlePaletteSubmit with skipSafety=true.
    if (safetyMode.enabled && !opts?.skipSafety) {
      paletteAbortRef.current?.abort();
      const safetyController = new AbortController();
      paletteAbortRef.current = safetyController;
      setPaletteProcessing(true);
      setPaletteStartedAt(Date.now());
      setPaletteStage("ai");
      setPaletteDetail("A confirmar a tua intencao...");
      setAiLastDescription(description);
      setAiLastRange(range);
      try {
        const response = await fetch("/api/ai/understand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description, providerConfig: aiConfig }),
          signal: safetyController.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Falha na confirmacao");
        const interp = typeof data.interpretation === "string" ? data.interpretation : "";
        if (interp) {
          setPaletteOpen(false);
          setSafetyInterp({ interpretation: interp, description, range });
        } else {
          // No paraphrase came back — fall through to the full plan call.
          await handlePaletteSubmit(description, range, { skipSafety: true });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          addToast("Pedido cancelado.", "warning");
        } else {
          addToast(`Falha na confirmacao: ${err instanceof Error ? err.message : "erro"}`, "error");
        }
      } finally {
        setPaletteProcessing(false);
        setPaletteStage("idle");
        setPaletteDetail("");
        setPaletteStartedAt(null);
        paletteAbortRef.current = null;
      }
      return;
    }

    // Cancel any previous in-flight palette call
    paletteAbortRef.current?.abort();
    const controller = new AbortController();
    paletteAbortRef.current = controller;

    setPaletteProcessing(true);
    setPaletteStartedAt(Date.now());
    setPaletteStage("idle");
    setPaletteDetail("A preparar pedido...");
    // Remember the original prompt + range so the user can refine later.
    setAiLastDescription(description);
    setAiLastRange(range);
    try {
      // Use anchor date when set (palette opened from a specific day), else fall back to today.
      const anchor = paletteAnchorDate || today;
      const anchorKey = toKey(anchor);
      let from = anchorKey;
      let to = anchorKey;
      if (range === "week") {
        const monday = new Date(anchor);
        const offset = (anchor.getDay() + 6) % 7;
        monday.setDate(anchor.getDate() - offset);
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);
        from = toKey(monday);
        to = toKey(friday);
      } else if (range === "month") {
        from = toKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
        const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
        to = toKey(new Date(anchor.getFullYear(), anchor.getMonth(), lastDay));
      }

      // Send EVERY non-closed task to the AI (not just the scoped calendar
      // view), so work in other sprints/months is still a candidate.
      const tasksForAI: Array<{ id: string; title: string; status?: string; statusId?: string; timeline?: TaskStatusTimeline }> = aiCandidateTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        statusId: t.statusId,
        timeline: t.timeline,
      }));

      // Optionally fetch recent GitLab activity for the same range
      let gitlabActivity: unknown[] | undefined;
      if (gitlabConfig) {
        setPaletteStage("gitlab");
        setPaletteDetail(`A obter commits/MRs de ${from === to ? from : `${from} a ${to}`}...`);
        try {
          const gitlabResponse = await fetch("/api/gitlab/activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config: gitlabConfig,
              since: new Date(from + "T00:00:00").toISOString(),
              until: new Date(to + "T23:59:59").toISOString(),
            }),
            signal: controller.signal,
          });
          if (gitlabResponse.ok) {
            const data = await gitlabResponse.json();
            gitlabActivity = data.activities || [];
            // Keep the raw activity list so the preview modal can show it.
            setAiGitlabActivities(Array.isArray(gitlabActivity) ? gitlabActivity as Array<{ type: "commit" | "merge_request"; title: string; project: string; createdAt: string; refIds: string[]; url: string }> : undefined);
            setPaletteDetail(`GitLab: ${Array.isArray(gitlabActivity) ? gitlabActivity.length : 0} item(s) recebidos.`);
          } else {
            const data = await gitlabResponse.json().catch(() => ({}));
            // Map common HTTP statuses to actionable messages
            const status = gitlabResponse.status;
            let msg: string;
            if (status === 401) msg = "Token GitLab invalido ou expirado. Atualiza nas definicoes.";
            else if (status === 403) msg = "Token GitLab sem permissoes suficientes (precisa read_api + read_user).";
            else if (status >= 500) msg = "GitLab indisponivel. Tenta de novo em alguns minutos.";
            else msg = `GitLab ${status}: ${data.error || "erro desconhecido"}`;
            addToast(msg, "warning");
          }
        } catch (err) {
          addToast(`GitLab indisponivel: ${err instanceof Error ? err.message : "rede"}`, "warning");
        }
      }

      // On-demand fetch of GitLab-referenced work packages that aren't in the
      // current task list. The IRN task fetch is scoped (sprint / current
      // month), so tasks the user touched today but that live outside that
      // scope (e.g. an older WP just moved to "MR para DEV") never reach the
      // AI. Here we collect refIds from the activity, drop any that already
      // resolve (by task id OR `#ref` in a title — so #6026 stays mapped to
      // #32397), keep only 5-digit ids (this instance's WP ids; 4-digit values
      // are business refs that live in titles), and fetch them.
      if (gitlabActivity && Array.isArray(gitlabActivity) && authToken && authUrl) {
        const knownIds = new Set(tasksForAI.map(t => t.id));
        const titleHasRef = (ref: string) => tasksForAI.some(t => t.title.includes(`#${ref}`));
        const candidateRefs = new Set<string>();
        for (const act of gitlabActivity as Array<{ refIds?: string[] }>) {
          for (const ref of act.refIds || []) {
            if (!/^\d{5}$/.test(ref)) continue;          // only OP-shaped ids
            if (knownIds.has(ref) || titleHasRef(ref)) continue; // already resolvable
            candidateRefs.add(ref);
          }
        }
        const refsToFetch = Array.from(candidateRefs).slice(0, 10); // cap API calls
        if (refsToFetch.length > 0) {
          setPaletteDetail(`A obter ${refsToFetch.length} tarefa(s) referenciada(s) no GitLab...`);
          const fetched = await Promise.all(refsToFetch.map(async ref => {
            try {
              const r = await fetch(`/api/openproject/get-task?taskId=${encodeURIComponent(ref)}`, {
                headers: { Authorization: `Bearer ${authToken}`, "X-OpenProject-URL": authUrl },
                signal: controller.signal,
              });
              if (!r.ok) return null;
              const d = await r.json();
              if (!d?.id || !d?.title) return null;
              return d as { id: string; title: string; status?: string; statusId?: string; lockVersion?: number };
            } catch {
              return null;
            }
          }));
          const newTasks = fetched.filter((t): t is NonNullable<typeof t> => !!t && !knownIds.has(t.id));
          for (const t of newTasks) {
            tasksForAI.push({ id: t.id, title: t.title, status: t.status, statusId: t.statusId });
          }
          // Also fold them into todoList so the preview can resolve titles and
          // a follow-up status change has the lockVersion it needs.
          if (newTasks.length > 0) {
            onTodosUpdate?.(prev => {
              const existing = new Set(prev.map(p => p.id));
              const additions = newTasks
                .filter(t => !existing.has(t.id))
                .map(t => ({ id: t.id, title: t.title, status: t.status, statusId: t.statusId, lockVersion: t.lockVersion, date: null } as TodoItem));
              return additions.length > 0 ? [...prev, ...additions] : prev;
            });
          }
        }
      }

      setPaletteStage("ai");
      setPaletteDetail(`A consultar ${aiConfig.kind} com ${tasksForAI.length} tarefa(s)${gitlabActivity ? ` + ${gitlabActivity.length} item(s) GitLab` : ""}...`);
      const response = await fetch("/api/ai/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          dateRange: { from, to },
          tasks: tasksForAI,
          weights: statusWeights,
          schedule,
          providerConfig: aiConfig,
          gitlabActivity,
          timeEntriesData: timeEntries?.byTask ? Object.fromEntries(
            Object.entries(timeEntries.byTask).map(([taskId, history]) => [taskId, history.totalHours])
          ) : undefined,
          meetings: meetingsHours > 0 && meetingsTaskId ? {
            taskId: meetingsTaskId,
            taskTitle: meetingsTask?.title || "Meetings",
            hours: meetingsHours,
          } : undefined,
          availableStatuses,
        }),
        signal: controller.signal,
      });
      setPaletteStage("parse");
      setPaletteDetail("A validar e processar a resposta...");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Falha na geracao");
      }
      const items: AIDistributionItem[] = Array.isArray(data.items) ? data.items : [];
      const statusActionsFromApi: AIUpdateStatusAction[] = Array.isArray(data.actions)
        ? data.actions.filter((a: { kind?: string }) => a && a.kind === "update_status")
        : [];
      setAiReasoning(typeof data.reasoning === "string" ? data.reasoning : undefined);
      setAiWarnings(Array.isArray(data.warnings) ? data.warnings : undefined);
      setAiRawResponse(typeof data.rawResponse === "string" ? data.rawResponse : undefined);
      setAiGitlabSummary(data.gitlabSummary && typeof data.gitlabSummary === "object" ? data.gitlabSummary : undefined);
      setAiUnmatched(Array.isArray(data.unmatchedActivities) ? data.unmatchedActivities : undefined);
      setAiDebug(data.debug && typeof data.debug === "object" ? data.debug : undefined);
      setAiStatusActions(statusActionsFromApi.length > 0 ? statusActionsFromApi : undefined);
      setPaletteOpen(false);
      setAiPreview(items);
    } catch (err) {
      // Aborts are deliberate user cancellations, not errors.
      if (err instanceof DOMException && err.name === "AbortError") {
        addToast("Pedido cancelado.", "warning");
      } else if ((err as { name?: string })?.name === "AbortError") {
        addToast("Pedido cancelado.", "warning");
      } else {
        const raw = err instanceof Error ? err.message : "Erro desconhecido";
        let msg = `Erro IA: ${raw}`;
        if (/401/.test(raw)) msg = "API key da IA invalida. Atualiza nas definicoes.";
        else if (/403/.test(raw)) msg = "API key da IA sem permissoes ou modelo nao disponivel.";
        else if (/429/.test(raw)) msg = "Limite de pedidos atingido. Tenta noutro modelo (Groq tem maior quota gratuita).";
        else if (/5\d\d/.test(raw)) msg = "Fornecedor de IA indisponivel. Tenta de novo em alguns minutos.";
        addToast(msg, "error");
      }
    } finally {
      setPaletteProcessing(false);
      setPaletteStage("idle");
      setPaletteDetail("");
      setPaletteStartedAt(null);
      paletteAbortRef.current = null;
    }
  }

  function handlePaletteCancel() {
    paletteAbortRef.current?.abort();
  }

  async function saveAIDistribution(items: AIDistributionItem[], statusActions: AIUpdateStatusAction[] = []) {
    // Group by day
    const grouped = new Map<string, Recommendation[]>();
    for (const it of items) {
      if (!grouped.has(it.dayKey)) grouped.set(it.dayKey, []);
      grouped.get(it.dayKey)!.push({ taskId: it.taskId, taskTitle: it.taskTitle, hours: it.hours });
    }
    const dayEntries = Array.from(grouped.entries()).map(([dayKey, recs]) => ({
      date: new Date(dayKey + "T00:00:00"),
      recommendations: recs,
    }));
    setAiPreview(null);
    setAiStatusActions(undefined);

    // Status changes: sequential (lockVersion bumps after each call).
    // Apply BEFORE hours so a "move to Em Desenvolvimento + log 4h" plan
    // ends with both visible on the next render.
    let appliedStatusCount = 0;
    let failedStatusCount = 0;
    for (const action of statusActions) {
      if (!authToken || !authUrl) {
        failedStatusCount++;
        continue;
      }
      const task = todoList.find(t => t.id === action.taskId);
      if (!task || typeof task.lockVersion !== "number") {
        failedStatusCount++;
        continue;
      }
      try {
        const response = await fetch("/api/openproject/update-status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            "X-OpenProject-URL": authUrl,
          },
          body: JSON.stringify({ taskId: action.taskId, statusId: action.toStatusId, lockVersion: task.lockVersion }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          failedStatusCount++;
          addToast(data?.message || `Falha a mudar estado de "${action.taskTitle}".`, "error");
          continue;
        }
        const nextStatus = data.status || action.toStatusName;
        const nextStatusId = data.statusId || action.toStatusId;
        const nextLockVersion = typeof data.lockVersion === "number" ? data.lockVersion : task.lockVersion + 1;
        onTodosUpdate?.(prev => prev.map(t =>
          t.id === action.taskId
            ? { ...t, status: nextStatus, statusId: nextStatusId, lockVersion: nextLockVersion }
            : t
        ));
        auditLog.append({
          kind: "update_status",
          taskId: action.taskId,
          taskTitle: action.taskTitle,
          before: action.fromStatusName || task.status || null,
          after: nextStatus,
          source: action.source || "ai",
        });
        appliedStatusCount++;
      } catch (err) {
        failedStatusCount++;
        addToast(`Erro de rede a mudar estado: ${err instanceof Error ? err.message : "tenta de novo"}.`, "error");
      }
    }
    if (appliedStatusCount > 0) {
      addToast(
        failedStatusCount > 0
          ? `${appliedStatusCount} estado(s) alterado(s); ${failedStatusCount} falharam.`
          : `${appliedStatusCount} estado(s) alterado(s).`,
        failedStatusCount > 0 ? "warning" : "success",
      );
    }

    await saveMultipleDays(dayEntries);
  }

  // --- Keyboard shortcuts ---
  useKeyboardShortcuts({
    onPalette: () => openPalette(true),
    onPrevMonth: goToPreviousMonth,
    onNextMonth: goToNextMonth,
    onToday: goToToday,
    onWeekFill: () => setShowWeekFill(true),
    onMonthFill: () => setShowMonthFill(true),
    onSettings: () => setSettingsOpen(true),
    onEscape: () => {
      // close in priority order
      if (paletteOpen) { setPaletteOpen(false); return; }
      if (aiPreview) { setAiPreview(null); return; }
      if (selectedTodo) { setSelectedTodo(null); return; }
      if (confirmationModal) { setConfirmationModal(null); return; }
      if (clearHoursModal) { setClearHoursModal(null); return; }
      if (showClearMonth) { setShowClearMonth(false); return; }
      if (showWeekFill) { setShowWeekFill(false); return; }
      if (showMonthFill) { setShowMonthFill(false); return; }
      if (showTaskAssignment) { setShowTaskAssignment(false); return; }
      if (selectedDay) { setSelectedDay(null); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
    },
  });

  const calendarContent = (
    <MonthGrid
      isLoading={isLoading}
      currentYear={currentYear}
      currentMonth={currentMonth}
      totalCells={totalCells}
      startOffset={startOffset}
      daysInMonth={daysInMonth}
      today={today}
      holidayMap={holidayMap}
      todoMap={todoMap}
      sprintDayKeys={sprintDayKeys}
      savingDays={savingDays}
      timelines={timelines}
      statusWeights={statusWeights}
      timeEntries={timeEntries}
      holidays={holidays}
      activeSprint={activeSprint}
      activeSprintInfo={activeSprintInfo}
      taskCount={monthDevelopmentTasks.length}
      getExpectedHours={getExpectedHours}
      onSelectDay={({ date, todos, holiday, actualHours, expectedHours }) => {
        setSelectedDay({ date, todos, holiday, actualHours, expectedHours });
        setShowDayGitLab(false);
        dayGitLab.clear();
        setDayManualHours({});
        setLoggedEdits({});
      }}
      onTodoClick={setSelectedTodo}
      onClearDay={(date) => setClearHoursModal(date)}
    />
  );

  return (
    <AppShell
      sidebar={
        <Sidebar
          userName={userName}
          userEmail={userEmail}
          url={authUrl || ""}
          onLogout={onLogout || (() => {})}
          todos={todoList}
          sprints={sprints}
          activeSprint={activeSprint}
          setActiveSprint={(s) => {
            setActiveSprint(s);
            if (s) localStorage.setItem("active_sprint", s);
            else localStorage.removeItem("active_sprint");
          }}
          pinnedTaskIds={allPinnedIds}
          onTaskClick={setSelectedTodo}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />
      }
      topBar={
        <TopBar
          year={currentYear}
          month={currentMonth}
          onPrev={goToPreviousMonth}
          onNext={goToNextMonth}
          onToday={goToToday}
          onPalette={() => openPalette(true)}
          onSettings={() => setSettingsOpen(true)}
          onWeekFill={() => setShowWeekFill(true)}
          onMonthFill={() => setShowMonthFill(true)}
          onClearMonth={() => setShowClearMonth(true)}
          onReload={() => onMonthChange?.()}
          isReloading={isLoading}
          isLoading={isLoading}
          theme={theme}
          onCycleTheme={cycleTheme}
          view={view}
          onSetView={setView}
          gitlabBanner={
            gitlabCheck.shouldShow && gitlabCheck.counts
              ? {
                  commits: gitlabCheck.counts.commits,
                  mrs: gitlabCheck.counts.mrs,
                  onReview: () => {
                    setPalettePrefill("Revisa a minha actividade GitLab de hoje e propoe alteracoes (estado + horas).");
                    setPaletteRange("day");
                    openPalette(true);
                  },
                  onDismiss: gitlabCheck.dismiss,
                }
              : undefined
          }
        />
      }
      drawer={
        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          schedule={schedule}
          onScheduleSave={saveSchedule}
          onScheduleReset={resetSchedule}
          timelines={timelines}
          statusWeights={statusWeights}
          overrides={weightOverrides}
          setWeight={setWeight}
          resetWeight={resetWeight}
          resetAllWeights={resetAllWeights}
          meetingsTaskId={meetingsTaskId}
          setMeetingsTaskId={setMeetingsTaskId}
          saveMeetingsTaskId={saveMeetingsTask}
          meetingsHours={meetingsHours}
          setMeetingsHours={setMeetingsHours}
          aiConfig={aiConfig}
          aiSettingsSlot={<AISettings config={aiConfig} onSave={setAiConfig} onClear={clearAiConfig} />}
          gitlabConfig={gitlabConfig}
          gitlabSettingsSlot={<GitLabSettings config={gitlabConfig} onSave={setGitlabConfig} onClear={clearGitlabConfig} />}
          inferenceSettingsSlot={<TimelineInferenceSettings config={inferenceConfig} setConfig={setInferenceConfig} reset={resetInference} />}
          kanbanSettingsSlot={
            <KanbanColumnsSettings
              availableStatuses={availableStatuses}
              config={kanbanColumns}
              toggleVisible={toggleKanbanVisible}
              moveColumn={moveKanbanColumn}
              reset={resetKanbanColumns}
            />
          }
          theme={theme}
          setTheme={setTheme}
        />
      }
    >
      {view === "kanban" ? (
        <KanbanBoard
          tasks={monthDevelopmentTasks}
          availableStatuses={availableStatuses}
          columns={kanbanColumns}
          weights={statusWeights}
          authToken={authToken}
          authUrl={authUrl}
          onTaskClick={setSelectedTodo}
          onToggleColumnVisible={toggleKanbanVisible}
          onMoveColumn={moveKanbanColumn}
          onStatusChanged={(taskId, result) => {
            onTodosUpdate?.(prev => prev.map(t =>
              t.id === taskId
                ? { ...t, status: result.status, statusId: result.statusId, lockVersion: result.lockVersion }
                : t
            ));
          }}
        />
      ) : (
        calendarContent
      )}

      {/* Task detail modal */}
      {selectedTodo && (
        <TaskModal
          todo={selectedTodo}
          statusWeights={statusWeights}
          availableStatuses={availableStatuses}
          authToken={authToken}
          authUrl={authUrl}
          onClose={() => setSelectedTodo(null)}
          onStatusChanged={(taskId, result) => {
            // Patch the corresponding task in todoList in place so the calendar,
            // sidebar, day modal, and Kanban view all reflect the new state
            // without forcing a full month reload.
            onTodosUpdate?.(prev => prev.map(t => {
              if (t.id !== taskId) return t;
              const next = { ...t, status: result.status, statusId: result.statusId, lockVersion: result.lockVersion };
              // Reflect the change in the in-memory selectedTodo too, so the open modal updates.
              setSelectedTodo(curr => curr && curr.id === taskId ? next : curr);
              return next;
            }));
          }}
          onInferredClick={(taskTitle, seg) => {
            const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
            const to = seg.toDate ?? new Date().toISOString().slice(0, 10);
            const prompt = `Confirma o que fizeste em "${taskTitle}" entre ${fmt(seg.fromDate)} e ${fmt(to)}.`;
            setSelectedTodo(null);
            setPalettePrefill(prompt);
            setPaletteRange("week");
            setPaletteOpen(true);
          }}
        />
      )}

      {/* Day detail modal */}
      {selectedDay && (() => {
        const dayKey = toKey(selectedDay.date);
        const weekday = selectedDay.date.toLocaleDateString("pt-PT", { weekday: "long" });
        const datePart = selectedDay.date.toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
        const expected = selectedDay.expectedHours ?? null;
        const actual = timeEntries.byDay[dayKey] || 0;
        const remaining = expected !== null ? Math.max(0, expected - actual) : 0;
        const progressPct = expected && expected > 0 ? Math.min(100, (actual / expected) * 100) : 0;
        const isOver = expected !== null && actual > expected;
        const isComplete = expected !== null && actual >= expected && expected > 0;
        const byDayTaskEntries = timeEntries.byDayTask[dayKey] ? Object.entries(timeEntries.byDayTask[dayKey]) : [];

        // Live list of the day's tasks: the user's assignments for this day,
        // merged with whatever todos were already active when the day opened.
        // Driven by `assignments` so adding/removing a task updates immediately.
        const dayTaskMap = new Map<string, TodoItem>();
        for (const t of selectedDay.todos) dayTaskMap.set(t.id, t);
        for (const a of getAssignmentsForDay(dayKey)) {
          if (dayTaskMap.has(a.taskId)) continue;
          const full = todoList.find(t => t.id === a.taskId);
          dayTaskMap.set(a.taskId, full || { id: a.taskId, title: a.taskTitle, date: null });
        }
        const dayTasks = Array.from(dayTaskMap.values());
        const manualTotal = dayTasks.reduce((s, t) => s + (dayManualHours[t.id] || 0), 0);

        const saveManualHours = () => {
          const recs = dayTasks
            .filter(t => (dayManualHours[t.id] || 0) > 0)
            .map(t => ({ taskId: t.id, taskTitle: t.title, hours: dayManualHours[t.id] }));
          if (recs.length > 0) saveRecommendedHours(selectedDay.date, recs);
        };

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in" onClick={() => setSelectedDay(null)}>
          <div className={`w-full ${showDayGitLab ? "max-w-4xl" : "max-w-2xl"} rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 h-[85vh] max-h-[85vh] flex flex-col animate-slide-up transition-[max-width]`} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400">{weekday}</p>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{datePart}</h2>
                {selectedDay.holiday && (
                  <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {selectedDay.holiday.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {gitlabConfig && (
                  <button
                    onClick={() => {
                      const next = !showDayGitLab;
                      setShowDayGitLab(next);
                      if (next) dayGitLab.load(dayKey);
                    }}
                    title="Ver commits/MRs deste dia no GitLab"
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                      showDayGitLab
                        ? "border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="inline-block align-text-bottom">
                      <path d="M8 14l-5-9 2 0 3 5 3-5 2 0z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                    <span className="ml-1">GitLab</span>
                  </button>
                )}
                <ModalCloseButton onClick={() => setSelectedDay(null)} />
              </div>
            </div>

            <div className="flex-1 min-h-0 flex">
              {/* Left: main content */}
              <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
              {/* Progress bar */}
              {expected !== null && expected > 0 && (
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400">Progresso do dia</span>
                    <span className={`text-sm font-mono font-semibold ${isOver ? "text-amber-600 dark:text-amber-400" : isComplete ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-200"}`}>
                      {formatHours(actual)}h / {expected}h
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full transition-all ${isOver ? "bg-amber-500" : isComplete ? "bg-emerald-500" : "bg-indigo-500"}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                    {remaining > 0 ? <span>Falta {formatHours(remaining)}h</span> : <span>Dia completo</span>}
                    {isOver && <span className="text-amber-600 dark:text-amber-400">+{formatHours(actual - expected)}h acima</span>}
                  </div>
                </div>
              )}

              {/* Tarefas do dia — o utilizador adiciona as tarefas e regista horas/estado */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400">
                    Tarefas do dia {dayTasks.length > 0 && <span className="text-slate-400">({dayTasks.length})</span>}
                  </p>
                  <button
                    onClick={() => setShowTaskAssignment(true)}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    + Adicionar tarefa
                  </button>
                </div>
                {dayTasks.length > 0 ? (
                  <div className="space-y-1.5">
                    {dayTasks.map((todo) => {
                      const weight = timelines[todo.id] ? getStatusWeightForDay(timelines[todo.id], dayKey, statusWeights) : null;
                      const pipColor = weight === null ? "bg-slate-300 dark:bg-slate-600"
                        : weight >= 0.8 ? "bg-emerald-500"
                        : weight >= 0.4 ? "bg-amber-500"
                        : weight > 0 ? "bg-orange-400"
                        : "bg-slate-300 dark:bg-slate-600";
                      return (
                        <div
                          key={todo.id}
                          className="group flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--surface-2)] dark:bg-slate-800/50 p-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                        >
                          <span className={`h-2 w-2 rounded-full shrink-0 ${pipColor}`} />
                          <button
                            onClick={() => setSelectedTodo(todo)}
                            title="Abrir tarefa (alterar estado)"
                            className="flex-1 min-w-0 text-left"
                          >
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{todo.title}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">#{todo.id}</span>
                              {todo.status && <span className="text-[10px] text-slate-500 dark:text-slate-400">· {todo.status}</span>}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={12}
                              step={0.5}
                              value={dayManualHours[todo.id] ?? ""}
                              placeholder="0"
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                setDayManualHours(prev => ({ ...prev, [todo.id]: Number.isFinite(v) ? Math.max(0, v) : 0 }));
                              }}
                              className="w-14 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-1 text-sm text-center font-semibold text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                              title="Horas a registar"
                            />
                            <span className="text-[10px] text-slate-400">h</span>
                            <button
                              onClick={() => unassignTask(todo.id, dayKey)}
                              title="Remover tarefa do dia"
                              className="rounded p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                            >
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-4 text-center">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma tarefa. Usa &quot;+ Adicionar tarefa&quot; para escolher as tuas.</p>
                  </div>
                )}
                {manualTotal > 0 && (
                  <button
                    onClick={saveManualHours}
                    disabled={isSavingHours}
                    className="mt-2.5 w-full rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingHours ? "A guardar..." : `Guardar ${formatHours(manualTotal)}h`}
                  </button>
                )}
              </div>

              {/* Horas registadas — editaveis / removiveis */}
              {byDayTaskEntries.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-2">Horas registadas</p>
                  <div className="space-y-1">
                    {byDayTaskEntries.map(([taskId, hours]) => {
                      const task = todoList.find(t => t.id === taskId);
                      const title = task?.title || `Task #${taskId}`;
                      const editValue = loggedEdits[taskId] ?? String(hours);
                      const parsed = parseFloat(editValue);
                      const changed = Number.isFinite(parsed) && parsed !== hours;
                      return (
                        <div key={taskId} className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/60 p-2 text-xs">
                          <span className="text-emerald-900 dark:text-emerald-200 truncate flex-1">{title}</span>
                          <input
                            type="number"
                            min={0}
                            max={12}
                            step={0.5}
                            value={editValue}
                            disabled={isSavingHours}
                            onChange={(e) => setLoggedEdits(prev => ({ ...prev, [taskId]: e.target.value }))}
                            className="w-14 rounded-md border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-1.5 py-1 text-center font-mono font-semibold text-emerald-700 dark:text-emerald-300 focus:border-emerald-500 focus:outline-none"
                            title="Editar horas"
                          />
                          <span className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70">h</span>
                          {changed && (
                            <button
                              onClick={() => editLoggedTask(selectedDay.date, taskId, title, Math.max(0, parsed))}
                              disabled={isSavingHours}
                              title="Guardar alteracao"
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition disabled:opacity-50"
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          )}
                          <button
                            onClick={() => removeLoggedTask(selectedDay.date, taskId)}
                            disabled={isSavingHours}
                            title="Remover horas desta tarefa"
                            className="rounded p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition disabled:opacity-50"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>

              {/* Right: GitLab activity panel (sidebar-style, like the task sidebar) */}
              {showDayGitLab && (
                <aside className="w-72 shrink-0 border-l border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 overflow-y-auto p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400">
                      GitLab
                      {dayGitLab.activities && dayGitLab.activities.length > 0 && (
                        <span className="ml-1 text-slate-400">
                          ({dayGitLab.activities.filter(a => a.type === "commit").length}c · {dayGitLab.activities.filter(a => a.type === "merge_request").length} MR)
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex-1">
                    {dayGitLab.loading ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic py-2">A obter atividade…</p>
                    ) : dayGitLab.error ? (
                      <p className="text-xs text-rose-600 dark:text-rose-400 py-2">{dayGitLab.error}</p>
                    ) : (
                      <GitLabActivityList activities={dayGitLab.activities || []} emptyLabel="Sem commits/MRs neste dia." />
                    )}
                  </div>
                  {dayGitLab.activities && dayGitLab.activities.length > 0 && (
                    <button
                      onClick={() => {
                        setPaletteAnchorDate(selectedDay.date);
                        setPaletteRange("day");
                        setPalettePrefill("Analisa a minha atividade GitLab deste dia e propoe horas e estados.");
                        setSelectedDay(null);
                        openPalette(false);
                      }}
                      className="mt-3 w-full rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-3 py-2 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition"
                    >
                      Registar horas via IA
                    </button>
                  )}
                </aside>
              )}
            </div>

            {/* Sticky footer */}
            {expected !== null && (
              <div className="flex gap-2 p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <button
                  onClick={() => {
                    setPaletteAnchorDate(selectedDay.date);
                    setPaletteRange("day");
                    setPalettePrefill("");
                    setSelectedDay(null);
                    openPalette(false); // keep the anchor/range we just set
                  }}
                  title={`Abrir assistente IA para ${dayKey}`}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4l3 8 2-4 4-2-9-2zM10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  IA
                </button>
                {actual > 0 && (
                  <button
                    onClick={() => setClearHoursModal(selectedDay.date)}
                    disabled={isSavingHours}
                    className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition disabled:opacity-50"
                  >
                    Limpar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        );
      })()}

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
          timelines={timelines}
          statusWeights={statusWeights}
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
          timelines={timelines}
          statusWeights={statusWeights}
          onSave={(entries) => { saveMultipleDays(entries); setShowMonthFill(false); }}
          onClose={() => setShowMonthFill(false)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); setPalettePrefill(""); setPaletteAnchorDate(null); }}
        onSubmit={handlePaletteSubmit}
        onCancel={handlePaletteCancel}
        isProcessing={paletteProcessing}
        defaultRange={paletteRange}
        defaultText={palettePrefill || undefined}
        hasAIConfigured={!!aiConfig}
        hasGitLabConfigured={!!gitlabConfig}
        onOpenSettings={() => setSettingsOpen(true)}
        processingStage={paletteStage}
        processingDetail={paletteDetail}
        processingStartedAt={paletteStartedAt}
        anchorDate={paletteAnchorDate}
        lastTasksFetchedAt={lastTasksFetchedDisplay || undefined}
      />

      {/* Phase 12 — safety-mode "understand-first" overlay. */}
      {safetyInterp && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 animate-fade-in" onClick={() => setSafetyInterp(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700 animate-slide-up overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <p className="text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400 font-semibold mb-0.5">Confirmacao</p>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Aqui esta o que entendi</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{safetyInterp.interpretation}</p>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    const desc = safetyInterp.description;
                    setSafetyInterp(null);
                    setPalettePrefill(desc);
                    setPaletteRange(safetyInterp.range);
                    setPaletteOpen(true);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Reformular
                </button>
                <button
                  onClick={() => {
                    const { description, range } = safetyInterp;
                    setSafetyInterp(null);
                    // Reopen the palette so the progress steps panel is visible
                    // during the AI call. Same pattern as the Refazer flow.
                    setPalettePrefill(description);
                    setPaletteRange(range);
                    setPaletteOpen(true);
                    queueMicrotask(() => handlePaletteSubmit(description, range, { skipSafety: true }));
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Saltar a etapa de confirmacao apenas para este pedido"
                >
                  Saltar seguranca
                </button>
                <button
                  onClick={() => {
                    const { description, range } = safetyInterp;
                    setSafetyInterp(null);
                    setPalettePrefill(description);
                    setPaletteRange(range);
                    setPaletteOpen(true);
                    queueMicrotask(() => handlePaletteSubmit(description, range, { skipSafety: true }));
                  }}
                  className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 transition"
                >
                  Avancar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {aiPreview && (
        <AIPreviewModal
          items={aiPreview}
          allTasks={todoList}
          onCancel={() => { setAiPreview(null); setAiReasoning(undefined); setAiWarnings(undefined); setAiRawResponse(undefined); setAiGitlabSummary(undefined); setAiUnmatched(undefined); setAiDebug(undefined); setAiGitlabActivities(undefined); setAiStatusActions(undefined); }}
          onConfirm={saveAIDistribution}
          statusActions={aiStatusActions}
          isSaving={isSavingHours}
          getExpectedHours={getExpectedHours}
          reasoning={aiReasoning}
          warnings={aiWarnings}
          rawResponse={aiRawResponse}
          gitlabSummary={aiGitlabSummary}
          unmatchedActivities={aiUnmatched}
          gitlabActivities={aiGitlabActivities}
          debug={aiDebug}
          originalDescription={aiLastDescription}
          onRefine={(feedback) => {
            const combined = `${aiLastDescription}\n\nFEEDBACK PARA REVISAO: ${feedback}`;
            // Close the preview AND open the palette with the combined prompt
            // visible — the palette renders the progress steps panel while the
            // call is in flight, so the user can see what's happening instead
            // of staring at an empty calendar.
            setAiPreview(null);
            setPalettePrefill(combined);
            setPaletteRange(aiLastRange);
            setPaletteOpen(true);
            // Defer to next microtask so the palette finishes mounting before
            // handlePaletteSubmit starts mutating its progress state.
            queueMicrotask(() => handlePaletteSubmit(combined, aiLastRange));
          }}
        />
      )}
    </AppShell>
  );
}
