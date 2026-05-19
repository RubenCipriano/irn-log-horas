"use client";

import { useEffect, useState } from "react";
import Calendar from "@/components/Calendar";
import type { TodoItem, TimeEntriesData, SprintInfo } from "@/types";

const EMPTY_TIME_ENTRIES: TimeEntriesData = { byDay: {}, byTask: {}, byDayTask: {} };

type StoredUser = { id?: number; name?: string; email?: string };

function readInitialAuth(): { url: string; token: string | null; user: StoredUser | null } {
  if (typeof window === "undefined") {
    return { url: "https://projetos.irn.justica.gov.pt/", token: null, user: null };
  }
  const token = localStorage.getItem("openproject_token");
  const url = localStorage.getItem("openproject_url") || "https://projetos.irn.justica.gov.pt/";
  let user: StoredUser | null = null;
  const rawUser = localStorage.getItem("openproject_user");
  if (rawUser) {
    try { user = JSON.parse(rawUser); } catch { /* ignore */ }
  }
  return { url, token, user };
}

export default function Home() {
  const [url, setUrl] = useState<string>(() => readInitialAuth().url);
  const [token, setToken] = useState<string | null>(() => readInitialAuth().token);
  const [user, setUser] = useState<StoredUser | null>(() => readInitialAuth().user);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntriesData>(EMPTY_TIME_ENTRIES);
  const [sprints, setSprints] = useState<SprintInfo[]>([]);

  const fetchTodos = async (authToken: string, authUrl: string) => {
    setIsLoading(true);
    try {
      // Read the inference config from localStorage so verify-token can apply it
      // server-side. The Calendar component owns this state via useTimelineInference.
      let inferenceConfig: unknown;
      try {
        const raw = localStorage.getItem("timeline_inference_v1");
        if (raw) inferenceConfig = JSON.parse(raw);
      } catch {
        // ignore
      }
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
        if (data.user) setUser(data.user);
      }
    } catch {
      // failed to fetch todos
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (token && url) {
      fetchTodos(token, url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTokenSubmit = async () => {
    if (!tokenInput.trim()) {
      setError("Insere um token de API.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      let inferenceConfig: unknown;
      try {
        const raw = localStorage.getItem("timeline_inference_v1");
        if (raw) inferenceConfig = JSON.parse(raw);
      } catch {
        // ignore
      }
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput, url, inferenceConfig }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Falha ao validar o token");
      }

      const data = await response.json();
      const todosWithDates = (data.todos || []).map((todo: TodoItem & { date: string | null }) => ({
        ...todo,
        date: todo.date ? new Date(todo.date) : null,
      }));

      localStorage.setItem("openproject_token", tokenInput);
      localStorage.setItem("openproject_url", url);
      localStorage.setItem("openproject_user", JSON.stringify(data.user));

      setToken(tokenInput);
      setUser(data.user);
      setTodos(todosWithDates);
      setTimeEntries(data.timeEntries || EMPTY_TIME_ENTRIES);
      setSprints(data.sprints || []);
      setTokenInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na autenticacao com OpenProject");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("openproject_token");
    localStorage.removeItem("openproject_url");
    localStorage.removeItem("openproject_user");
    setToken(null);
    setUser(null);
    setTokenInput("");
    setError("");
    setTodos([]);
    setTimeEntries(EMPTY_TIME_ENTRIES);
    setSprints([]);
  };

  if (token) {
    return (
      <Calendar
        todoList={todos}
        timeEntries={timeEntries}
        sprints={sprints}
        isLoading={isLoading}
        onMonthChange={() => fetchTodos(token, url)}
        onTimeEntriesUpdate={(updater) => setTimeEntries(updater)}
        authToken={token}
        authUrl={url}
        userName={user?.name}
        userEmail={user?.email}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-[var(--surface-2)] dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
            IRN
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Registo de Horas</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Liga ao teu OpenProject</p>
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="url" className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
            URL do OpenProject
          </label>
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://projetos.irn.justica.gov.pt/"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="token" className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
            API Token
          </label>
          <textarea
            id="token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Cola aqui o teu API token do OpenProject"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 font-mono text-xs"
            rows={3}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
            {error}
          </div>
        )}

        <button
          onClick={handleTokenSubmit}
          disabled={isLoading}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "A validar..." : "Entrar"}
        </button>

        <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
          Para gerar um token, vai ao OpenProject → perfil → &quot;Access tokens&quot; → criar token de API.
        </p>
      </div>
    </main>
  );
}
