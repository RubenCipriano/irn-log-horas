"use client";

import { useCallback, useState } from "react";
import type { AuditLogEntry } from "@/types";

const STORAGE_KEY = "audit_log_v1";
const MAX_ENTRIES = 200;

function readInitial(): AuditLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.slice(0, MAX_ENTRIES);
  } catch {
    // ignore malformed JSON
  }
  return [];
}

function persist(entries: AuditLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore quota / unavailable
  }
}

// Append-only ring buffer of the last 200 audit entries. Visible in
// Settings → Historico (Phase 12). Used to give the user a trail of
// every action the AI applied.
export function useAuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>(readInitial);

  const append = useCallback((entry: Omit<AuditLogEntry, "ts"> & { ts?: string }) => {
    const next: AuditLogEntry = { ts: entry.ts || new Date().toISOString(), ...entry } as AuditLogEntry;
    setEntries(prev => {
      const updated = [next, ...prev].slice(0, MAX_ENTRIES);
      persist(updated);
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { entries, append, clear };
}
