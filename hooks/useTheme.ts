"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "theme_v1";

function readInitial(): Theme {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(resolved: Resolved) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitial);
  const [resolved, setResolved] = useState<Resolved>(() => {
    const initial = readInitial();
    if (initial === "system") return systemPrefersDark() ? "dark" : "light";
    return initial;
  });

  // Apply class whenever resolved changes
  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  // React to system changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setResolved(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    const r = next === "system" ? (systemPrefersDark() ? "dark" : "light") : next;
    setResolved(r);
  }, []);

  const cycle = useCallback(() => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  }, [theme, setTheme]);

  return { theme, resolved, setTheme, cycle };
}
