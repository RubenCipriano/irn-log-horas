"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";

// Per-org "active project" state. Mirrors useCurrentOrgId — localStorage
// backed, syncs across tabs, falls back to null (= "All projects").
//
// Storage key is namespaced per org so switching orgs doesn't carry the
// wrong project context: `tf_current_project:{orgId}`.

const STORAGE_PREFIX = "tf_current_project:";

type Ctx = {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
};

const CurrentProjectContext = createContext<Ctx>({ projectId: null, setProjectId: () => {} });

export function CurrentProjectProvider({ children }: { children: ReactNode }) {
  const { orgId } = useCurrentOrgId();
  const [stored, setStored] = useState<string | null>(null);

  // Re-hydrate from localStorage when orgId changes.
  useEffect(() => {
    if (!orgId) { setStored(null); return; }
    try {
      const v = typeof window !== "undefined"
        ? localStorage.getItem(STORAGE_PREFIX + orgId)
        : null;
      setStored(v);
    } catch { /* private browsing */ }
  }, [orgId]);

  const setProjectId = useCallback((id: string | null) => {
    setStored(id);
    if (!orgId) return;
    try {
      if (typeof window !== "undefined") {
        if (id) localStorage.setItem(STORAGE_PREFIX + orgId, id);
        else localStorage.removeItem(STORAGE_PREFIX + orgId);
      }
    } catch { /* ignore */ }
  }, [orgId]);

  const value = useMemo(() => ({ projectId: stored, setProjectId }), [stored, setProjectId]);
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useCurrentProjectId() {
  return useContext(CurrentProjectContext);
}
