"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SyncedTaskItem } from "@/hooks/useSyncedTasks";

// Tasks assigned to me across every connection in the org. Backend
// (TasksMeEndpoints.cs) matches `(connectionId, assignee_upstream_id)`
// against connections the caller can see — Admins see all, everyone
// else only their own connections. Same `{ total, items }` envelope as
// `/synced` so the UI can reuse SyncedTaskItem.
export function useMyTasks(
  orgId: string | null | undefined,
  filters: {
    projectId?: string;
    search?: string;
    status?: string;
    versionId?: string;
    connectionId?: string;
    skip?: number;
    take?: number;
  } = {},
) {
  return useQuery({
    queryKey: ["my-tasks", orgId, filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.projectId) params.projectId = filters.projectId;
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.versionId) params.versionId = filters.versionId;
      if (filters.connectionId) params.connectionId = filters.connectionId;
      if (filters.skip) params.skip = filters.skip;
      if (filters.take) params.take = filters.take;
      const { data } = await api.get<{ total: number; items: SyncedTaskItem[] }>(
        `/api/orgs/${orgId}/tasks/me`,
        { params },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
