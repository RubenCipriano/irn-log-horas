"use client";

import { useCallback, useState } from "react";
import type { AvailableStatus } from "@/types";

export type KanbanColumnConfig = {
  statusId: string;
  visible: boolean;
};

const STORAGE_KEY = "kanban_columns_v1";

function readInitial(): KanbanColumnConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: unknown): c is KanbanColumnConfig =>
        !!c && typeof c === "object" && typeof (c as { statusId?: unknown }).statusId === "string"
      )
      .map(c => ({ statusId: c.statusId, visible: c.visible !== false }));
  } catch {
    return [];
  }
}

export function useKanbanColumns() {
  const [config, setConfig] = useState<KanbanColumnConfig[]>(readInitial);

  const persist = useCallback((next: KanbanColumnConfig[]) => {
    setConfig(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  // Merge stored config with current availableStatuses: keep order from stored,
  // append any new statuses at the end (visible by default unless they are closed).
  const merge = useCallback((available: AvailableStatus[]): KanbanColumnConfig[] => {
    const known = new Set(config.map(c => c.statusId));
    const merged: KanbanColumnConfig[] = [...config.filter(c => available.some(a => a.id === c.statusId))];
    for (const s of available) {
      if (!known.has(s.id)) {
        merged.push({ statusId: s.id, visible: !s.isClosed });
      }
    }
    return merged;
  }, [config]);

  const toggleVisible = useCallback((statusId: string) => {
    persist(config.map(c => c.statusId === statusId ? { ...c, visible: !c.visible } : c));
  }, [config, persist]);

  const moveColumn = useCallback((statusId: string, direction: "up" | "down") => {
    const idx = config.findIndex(c => c.statusId === statusId);
    if (idx === -1) return;
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= config.length) return;
    const next = [...config];
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  }, [config, persist]);

  const reset = useCallback(() => {
    persist([]);
  }, [persist]);

  // Synchronise the stored config against the current `available` list whenever
  // it changes. Cheap — runs in user code via useEffect on the consumer side.
  const sync = useCallback((available: AvailableStatus[]) => {
    const merged = merge(available);
    if (merged.length !== config.length || merged.some((c, i) => c.statusId !== config[i]?.statusId)) {
      persist(merged);
    }
  }, [merge, config, persist]);

  return { config, toggleVisible, moveColumn, reset, sync, merge };
}
