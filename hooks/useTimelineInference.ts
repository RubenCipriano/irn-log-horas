"use client";

import { useCallback, useState } from "react";
import type { TimelineInferenceConfig } from "@/types";
import { DEFAULT_TIMELINE_INFERENCE } from "@/types";
import { readJSON, writeJSON, removeKey } from "@/lib/storage/localStore";

const STORAGE_KEY = "timeline_inference_v1";

function readInitial(): TimelineInferenceConfig {
  const parsed = readJSON<Partial<TimelineInferenceConfig>>(STORAGE_KEY, {});
  return {
    enabled: parsed.enabled ?? DEFAULT_TIMELINE_INFERENCE.enabled,
    starterStates: parsed.starterStates ?? DEFAULT_TIMELINE_INFERENCE.starterStates,
    terminalStates: parsed.terminalStates ?? DEFAULT_TIMELINE_INFERENCE.terminalStates,
    fillState: parsed.fillState ?? DEFAULT_TIMELINE_INFERENCE.fillState,
  };
}

export function useTimelineInference() {
  const [config, setConfigState] = useState<TimelineInferenceConfig>(readInitial);

  const setConfig = useCallback((next: TimelineInferenceConfig) => {
    setConfigState(next);
    writeJSON(STORAGE_KEY, next);
  }, []);

  const reset = useCallback(() => {
    setConfigState(DEFAULT_TIMELINE_INFERENCE);
    removeKey(STORAGE_KEY);
  }, []);

  return { config, setConfig, reset };
}
