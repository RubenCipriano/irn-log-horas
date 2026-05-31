"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UnifiedProjectItem } from "@/lib/types";

// Merged native + upstream project list. This is the source of truth
// for /projects, the topbar ProjectSwitcher, and the calendar day-form's
// project picker — replaces useProjects(orgId) anywhere that wanted to
// see "all projects regardless of source".
export function useUnifiedProjects(
  orgId: string | null | undefined,
  includeArchived = false,
) {
  return useQuery({
    queryKey: ["projects-unified", orgId, includeArchived],
    queryFn: async () => {
      const { data } = await api.get<UnifiedProjectItem[]>(
        `/api/orgs/${orgId}/projects-unified`,
        { params: includeArchived ? { includeArchived: true } : {} },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}
