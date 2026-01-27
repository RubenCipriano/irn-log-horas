"use client";

import { useEffect, useState } from "react";
import Calendar from "@/components/Calendar";

type TodoItem = {
  id: string;
  title: string;
  date: Date;
};

export default function Home() {
  const [url, setUrl] = useState("https://projetos.irn.justica.gov.pt/");
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    const savedToken = localStorage.getItem("openproject_token");
    const savedUrl = localStorage.getItem("openproject_url");
    if (savedToken && savedUrl) {
      setToken(savedToken);
      setUrl(savedUrl);
      fetchTodos(savedToken, savedUrl);
    }
  }, []);

  const fetchTodos = async (authToken: string, authUrl: string) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: authToken,
          url: authUrl,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const todosWithDates = (data.todos || []).map((todo: any) => ({
          ...todo,
          date: new Date(todo.date),
        }));
        setTodos(todosWithDates);
        setTimeEntries(data.timeEntries || {});
      }
    } catch (err) {
      console.error("Failed to fetch todos:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTokenSubmit = async () => {
    if (!tokenInput.trim()) {
      setError("Please enter a token");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/openproject/verify-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: tokenInput,
          url: url,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to verify token");
      }

      const data = await response.json();

      // Convert date strings to Date objects
      const todosWithDates = (data.todos || []).map((todo: any) => ({
        ...todo,
        date: new Date(todo.date),
      }));

      // Store credentials and set todos
      localStorage.setItem("openproject_token", tokenInput);
      localStorage.setItem("openproject_url", url);
      localStorage.setItem("openproject_user", JSON.stringify(data.user));

      setToken(tokenInput);
      setTodos(todosWithDates);
      setTimeEntries(data.timeEntries || {});
      setTokenInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authenticate with OpenProject");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("openproject_token");
    localStorage.removeItem("openproject_url");
    localStorage.removeItem("openproject_user");
    setToken(null);
    setTokenInput("");
    setError("");
    setTodos([]);
  };

  if (token) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-start p-4 md:p-24">
        <div className="w-full max-w-3xl mb-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-green-50 p-4 dark:border-slate-800 dark:bg-green-950">
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-200">
                Connected to OpenProject
              </p>
              <p className="text-xs text-green-600 dark:text-green-300">{url}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => fetchTodos(token, url)}
                disabled={isLoading}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Recarregando..." : "Recarregar"}
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
        <Calendar 
          todoList={todos} 
          timeEntries={timeEntries} 
          isLoading={isLoading} 
          onMonthChange={() => fetchTodos(token, url)} 
          authToken={token}
          authUrl={url}
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">
          OpenProject
        </h1>

        <div className="mb-6">
          <label htmlFor="url" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            OpenProject URL
          </label>
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://projetos.irn.justica.gov.pt/"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-indigo-900"
          />
        </div>

        <div className="mb-6">
          <label htmlFor="token" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            API Token
          </label>
          <textarea
            id="token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Paste your OpenProject API token here"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-indigo-900 font-mono text-sm"
            rows={3}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}

        <button
          onClick={handleTokenSubmit}
          disabled={isLoading}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Verifying..." : "Submit"}
        </button>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          To get your API token, log in to OpenProject, go to your profile settings, and create a new API token under "Access tokens".
        </p>
      </div>
    </main>
  );
}
