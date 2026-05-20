"use client";

import { useCallback, useState } from "react";
import type { GitLabConfig } from "@/types";
import { readJSON, writeJSON, removeKey } from "@/lib/storage/localStore";

const STORAGE_KEY = "gitlab_config_v1";

function readInitial(): GitLabConfig | null {
  const parsed = readJSON<GitLabConfig | null>(STORAGE_KEY, null);
  if (parsed && parsed.baseUrl && parsed.accessToken) return parsed;
  return null;
}

export function useGitLabConfig() {
  const [config, setConfigState] = useState<GitLabConfig | null>(readInitial);

  const setConfig = useCallback((next: GitLabConfig) => {
    setConfigState(next);
    writeJSON(STORAGE_KEY, next);
  }, []);

  const clear = useCallback(() => {
    setConfigState(null);
    removeKey(STORAGE_KEY);
  }, []);

  return { config, setConfig, clear };
}
