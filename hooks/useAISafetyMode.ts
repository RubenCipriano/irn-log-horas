"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "ai_safety_mode_v1";

// Safety mode (Phase 12). When ON, the palette runs an extra "understand-first"
// step before the full plan call. Default ON for new installs.
function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "on";
  } catch {
    return true;
  }
}

export function useAISafetyMode() {
  const [enabled, setEnabledState] = useState<boolean>(readInitial);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return { enabled, setEnabled, toggle };
}
