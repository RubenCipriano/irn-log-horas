"use client";

import { useCallback, useState } from "react";
import type { AIProviderConfig } from "@/types";

const STORAGE_KEY = "ai_provider_config_v1";

function readInitial(): AIProviderConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AIProviderConfig;
    if (parsed && parsed.kind) return parsed;
  } catch {
    // ignore malformed JSON
  }
  return null;
}

export function useAIProvider() {
  const [config, setConfigState] = useState<AIProviderConfig | null>(readInitial);

  const setConfig = useCallback((next: AIProviderConfig) => {
    setConfigState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const clear = useCallback(() => {
    setConfigState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { config, setConfig, clear };
}
