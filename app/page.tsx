"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Calendar from "@/components/Calendar";
import type { TodoItem, TimeEntriesData, SprintInfo, AvailableStatus } from "@/types";
import { readJSON } from "@/lib/storage/localStore";

const EMPTY_TIME_ENTRIES: TimeEntriesData = { byDay: {}, byTask: {}, byDayTask: {} };
const DEFAULT_URL = "https://projetos.irn.justica.gov.pt/";

type StoredUser = { id?: number; name?: string; email?: string };

function readInitialAuth(): { url: string; token: string | null; user: StoredUser | null } {
  if (typeof window === "undefined") {
    return { url: DEFAULT_URL, token: null, user: null };
  }
  const token = localStorage.getItem("openproject_token");
  const url = localStorage.getItem("openproject_url") || DEFAULT_URL;
  let user: StoredUser | null = null;
  const rawUser = localStorage.getItem("openproject_user");
  if (rawUser) {
    try { user = JSON.parse(rawUser); } catch { /* ignore */ }
  }
  return { url, token, user };
}

export default function Home() {
  const router = useRouter();
  const [url] = useState<string>(() => readInitialAuth().url);
  const [token, setToken] = useState<string | null>(() => readInitialAuth().token);
  const [user, setUser] = useState<StoredUser | null>(() => readInitialAuth().user);
  const [isLoading, setIsLoading] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntriesData>(EMPTY_TIME_ENTRIES);
  const [sprints, setSprints] = useState<SprintInfo[]>([]);
  const [availableStatuses, setAvailableStatuses] = useState<AvailableStatus[]>([]);

  const fetchTodos = useCallback(async (authToken: string, authUrl: string) => {
    setIsLoading(true);
    try {
      // Inference config lives in localStorage (owned by useTimelineInference);
      // verify-token applies it server-side.
      const inferenceConfig = readJSON<unknown>("timeline_inference_v1", undefined);
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: authToken, url: authUrl, inferenceConfig }),
      });
      if (response.ok) {
        const data = await response.json();
        const todosWithDates = (data.todos || []).map((todo: TodoItem & { date: string | null }) => ({
          ...todo,
          date: todo.date ? new Date(todo.date) : null,
        }));
        setTodos(todosWithDates);
        setTimeEntries(data.timeEntries || EMPTY_TIME_ENTRIES);
        setSprints(data.sprints || []);
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

  const handleLogout = () => {
    localStorage.removeItem("openproject_token");
    localStorage.removeItem("openproject_url");
    localStorage.removeItem("openproject_user");
    setToken(null);
    setUser(null);
    setTodos([]);
    setTimeEntries(EMPTY_TIME_ENTRIES);
    setSprints([]);
    router.replace("/setup");
  };

  if (!token) {
    // Redirecting to /setup; render nothing to avoid a flash of the app shell.
    return null;
  }

  return (
    <Calendar
      todoList={todos}
      timeEntries={timeEntries}
      sprints={sprints}
      availableStatuses={availableStatuses}
      isLoading={isLoading}
      onMonthChange={() => fetchTodos(token, url)}
      onTimeEntriesUpdate={(updater) => setTimeEntries(updater)}
      onTodosUpdate={(updater) => setTodos(updater)}
      authToken={token}
      authUrl={url}
      userName={user?.name}
      userEmail={user?.email}
      onLogout={handleLogout}
    />
  );
}
