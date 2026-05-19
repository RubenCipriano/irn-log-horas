"use client";

import { useCallback, useState } from "react";
import type { StatusWeightConfig } from "@/types";
import { DEFAULT_STATUS_WEIGHTS } from "@/lib/status-timeline";

const STORAGE_KEY = "status_weights_v1";

function readInitial(): StatusWeightConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function useStatusWeights() {
  const [overrides, setOverrides] = useState<StatusWeightConfig>(readInitial);

  const persist = useCallback((next: StatusWeightConfig) => {
    setOverrides(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage quota errors swallowed
    }
  }, []);

  const setWeight = useCallback((statusLower: string, value: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(value * 10) / 10));
    persist({ ...overrides, [statusLower]: clamped });
  }, [overrides, persist]);

  const resetWeight = useCallback((statusLower: string) => {
    const next = { ...overrides };
    delete next[statusLower];
    persist(next);
  }, [overrides, persist]);

  const reset = useCallback(() => {
    persist({});
  }, [persist]);

  const weights: StatusWeightConfig = { ...DEFAULT_STATUS_WEIGHTS, ...overrides };

  return { weights, overrides, setWeight, resetWeight, reset };
}
