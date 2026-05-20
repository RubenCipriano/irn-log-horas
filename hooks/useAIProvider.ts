"use client";

import { useCallback, useState } from "react";
import type { AIProviderConfig } from "@/types";
import { readJSON, writeJSON, removeKey } from "@/lib/storage/localStore";

const STORAGE_KEY = "ai_provider_config_v1";

function readInitial(): AIProviderConfig | null {
  const parsed = readJSON<AIProviderConfig | null>(STORAGE_KEY, null);
  if (parsed && parsed.kind) return parsed;
  return null;
}

export function useAIProvider() {
  const [config, setConfigState] = useState<AIProviderConfig | null>(readInitial);

  const setConfig = useCallback((next: AIProviderConfig) => {
    setConfigState(next);
    writeJSON(STORAGE_KEY, next);
  }, []);

  const clear = useCallback(() => {
    setConfigState(null);
    removeKey(STORAGE_KEY);
  }, []);

  return { config, setConfig, clear };
}
