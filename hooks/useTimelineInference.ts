"use client";

import { useCallback, useState } from "react";
import type { TimelineInferenceConfig } from "@/types";
import { DEFAULT_TIMELINE_INFERENCE } from "@/types";

const STORAGE_KEY = "timeline_inference_v1";

function readInitial(): TimelineInferenceConfig {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_INFERENCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TIMELINE_INFERENCE;
    const parsed = JSON.parse(raw) as Partial<TimelineInferenceConfig>;
    return {
      enabled: parsed.enabled ?? DEFAULT_TIMELINE_INFERENCE.enabled,
      starterStates: parsed.starterStates ?? DEFAULT_TIMELINE_INFERENCE.starterStates,
      terminalStates: parsed.terminalStates ?? DEFAULT_TIMELINE_INFERENCE.terminalStates,
      fillState: parsed.fillState ?? DEFAULT_TIMELINE_INFERENCE.fillState,
    };
  } catch {
    return DEFAULT_TIMELINE_INFERENCE;
  }
}

export function useTimelineInference() {
  const [config, setConfigState] = useState<TimelineInferenceConfig>(readInitial);

  const setConfig = useCallback((next: TimelineInferenceConfig) => {
    setConfigState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const reset = useCallback(() => {
    setConfigState(DEFAULT_TIMELINE_INFERENCE);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { config, setConfig, reset };
}
