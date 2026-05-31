"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Three theme modes:
//   - "light" → force light (default for new visitors)
//   - "dark"  → force dark
//   - "auto"  → follow OS preference (matchMedia)
//
// Persisted in localStorage under `tf_theme`. The actual class on <html>
// (.dark or absent) is set programmatically — no @media query in CSS.
// This keeps the "Light" pick honoured even when the OS is dark.

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "tf_theme";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  /** Effective theme being shown right now ("light" or "dark"). */
  resolved: "light" | "dark";
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Read the persisted mode; default to "light" for new visitors. */
export function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  return "light";
}

/** Resolve "auto" against the OS; returns the concrete theme to apply. */
function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Toggle the .dark class on <html> based on a resolved mode. */
function applyTheme(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useThemeState(): ThemeContextValue {
  // The server renders the page assuming light (the default). On mount
  // the client reads localStorage and re-applies — there's a brief
  // mismatch window if the user has dark stored, mitigated by the
  // boot script in <html> head (see layout.tsx).
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  // First mount: hydrate from localStorage and apply.
  useEffect(() => {
    const stored = readStoredMode();
    setModeState(stored);
    const r = resolveMode(stored);
    setResolved(r);
    applyTheme(r);
  }, []);

  // If mode is "auto", listen for OS changes.
  useEffect(() => {
    if (mode !== "auto" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      const r = mq.matches ? "dark" : "light";
      setResolved(r);
      applyTheme(r);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    const r = resolveMode(next);
    setResolved(r);
    applyTheme(r);
  }

  return { mode, setMode, resolved };
}
