"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

// Single source of truth for "which org am I looking at right now".
// Resolution order: localStorage > auth.user.defaultOrgId. URL-based
// orgId (e.g. /orgs/{id}/...) would override here too once those URLs
// land; for now the entire authed surface is org-implicit.

const STORAGE_KEY = "tf_current_org";

type Ctx = {
  orgId: string | null;
  setOrgId: (id: string | null) => void;
};

const CurrentOrgContext = createContext<Ctx>({ orgId: null, setOrgId: () => {} });

export function CurrentOrgProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [stored, setStored] = useState<string | null>(null);

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    try {
      const v = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (v) setStored(v);
    } catch {
      /* private-mode browsers throw — ignore */
    }
  }, []);

  // Fall back to defaultOrgId whenever localStorage has nothing.
  const orgId = stored ?? auth.user?.defaultOrgId ?? null;

  const setOrgId = useCallback((id: string | null) => {
    setStored(id);
    try {
      if (typeof window !== "undefined") {
        if (id) localStorage.setItem(STORAGE_KEY, id);
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ orgId, setOrgId }), [orgId, setOrgId]);
  return <CurrentOrgContext.Provider value={value}>{children}</CurrentOrgContext.Provider>;
}

export function useCurrentOrgId() {
  return useContext(CurrentOrgContext);
}
