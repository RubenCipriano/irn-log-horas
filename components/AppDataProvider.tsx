"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TodoItem, TimeEntriesData, SprintInfo, AvailableStatus } from "@/types";
import { readJSON } from "@/lib/storage/localStore";
import { filterTasksToSprintWindow } from "@/lib/sprint-filtering";

const EMPTY_TIME_ENTRIES: TimeEntriesData = { byDay: {}, byTask: {}, byDayTask: {} };
const DEFAULT_URL = "https://projetos.irn.justica.gov.pt/";

type StoredUser = { id?: number; name?: string; email?: string };

type AppData = {
  token: string | null;
  url: string;
  user: StoredUser | null;
  todos: TodoItem[];
  timeEntries: TimeEntriesData;
  sprints: SprintInfo[];
  availableStatuses: AvailableStatus[];
  isLoading: boolean;
  refresh: () => void;
  setTodos: (updater: (prev: TodoItem[]) => TodoItem[]) => void;
  setTimeEntries: (updater: (prev: TimeEntriesData) => TimeEntriesData) => void;
  logout: () => void;
};

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppData must be used within <AppDataProvider>");
  return ctx;
}

function readInitial(): { url: string; token: string | null; user: StoredUser | null } {
  if (typeof window === "undefined") return { url: DEFAULT_URL, token: null, user: null };
  const token = localStorage.getItem("openproject_token");
  const url = localStorage.getItem("openproject_url") || DEFAULT_URL;
  let user: StoredUser | null = null;
  const rawUser = localStorage.getItem("openproject_user");
  if (rawUser) {
    try { user = JSON.parse(rawUser); } catch { /* ignore */ }
  }
  return { url, token, user };
}

// Holds auth + the loaded OpenProject data for the authenticated app shell.
// Mounted by the (app) route-group layout so navigating between /
// (calendar) and /kanban keeps the data — no refetch on view switch.
export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [url] = useState<string>(() => readInitial().url);
  const [token, setToken] = useState<string | null>(() => readInitial().token);
  const [user, setUser] = useState<StoredUser | null>(() => readInitial().user);
  const [todos, setTodosState] = useState<TodoItem[]>([]);
  const [timeEntries, setTimeEntriesState] = useState<TimeEntriesData>(EMPTY_TIME_ENTRIES);
  const [sprints, setSprints] = useState<SprintInfo[]>([]);
  const [availableStatuses, setAvailableStatuses] = useState<AvailableStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTodos = useCallback(async (authToken: string, authUrl: string) => {
    setIsLoading(true);
    try {
      const inferenceConfig = readJSON<unknown>("timeline_inference_v1", undefined);
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: authToken, url: authUrl, inferenceConfig }),
      });
      if (response.ok) {
        const data = await response.json();
        const sprintsData: SprintInfo[] = data.sprints || [];
        const todosWithDates = (data.todos || []).map((todo: TodoItem & { date: string | null }) => ({
          ...todo,
          date: todo.date ? new Date(todo.date) : null,
        }));
        // Trim stale work packages: keep only the previous/current/next sprint
        // window (tasks without a sprint are dropped). Applied globally here so
        // the sidebar, calendar AND the AI assistant all see the same set.
        const scopedTodos = filterTasksToSprintWindow(todosWithDates, sprintsData);
        setTodosState(scopedTodos);
        setTimeEntriesState(data.timeEntries || EMPTY_TIME_ENTRIES);
        setSprints(sprintsData);
        setAvailableStatuses(Array.isArray(data.availableStatuses) ? data.availableStatuses : []);
        if (data.user) setUser(data.user);
      }
    } catch {
      // failed to fetch todos
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Run once on mount: no token → onboarding at /setup; token → load data.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (!token) {
      router.replace("/setup");
      return;
    }
    fetchTodos(token, url);
  }, [token, url, router, fetchTodos]);

  const refresh = useCallback(() => {
    if (token) fetchTodos(token, url);
  }, [token, url, fetchTodos]);

  const logout = useCallback(() => {
    localStorage.removeItem("openproject_token");
    localStorage.removeItem("openproject_url");
    localStorage.removeItem("openproject_user");
    setToken(null);
    setUser(null);
    setTodosState([]);
    setTimeEntriesState(EMPTY_TIME_ENTRIES);
    setSprints([]);
    router.replace("/setup");
  }, [router]);

  const value: AppData = {
    token,
    url,
    user,
    todos,
    timeEntries,
    sprints,
    availableStatuses,
    isLoading,
    refresh,
    setTodos: setTodosState,
    setTimeEntries: setTimeEntriesState,
    logout,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
