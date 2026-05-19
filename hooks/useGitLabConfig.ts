"use client";

import { useCallback, useState } from "react";
import type { GitLabConfig } from "@/types";

const STORAGE_KEY = "gitlab_config_v1";

function readInitial(): GitLabConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GitLabConfig;
    if (parsed && parsed.baseUrl && parsed.accessToken) return parsed;
  } catch {
    // ignore
  }
  return null;
}

export function useGitLabConfig() {
  const [config, setConfigState] = useState<GitLabConfig | null>(readInitial);

  const setConfig = useCallback((next: GitLabConfig) => {
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
