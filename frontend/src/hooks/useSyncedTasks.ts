"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type SyncedTaskItem = {
  id: string;
  upstreamId: string;
  upstreamProjectId: string;
  title: string;
  status: string;
  assigneeUpstreamId: string | null;
  upstreamUpdatedAt: string | null;
  lastSyncedAt: string;
  upstreamVersionId: string | null;
  upstreamVersionName: string | null;
};

export type SyncedProjectGroup = {
  upstreamProjectId: string;
  taskCount: number;
};

export type SyncedVersionItem = {
  upstreamVersionId: string;
  upstreamVersionName: string;
  taskCount: number;
};

export function useSyncedProjects(
  orgId: string | null | undefined,
  connId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["synced-projects", orgId, connId],
    queryFn: async () =>
      (await api.get<SyncedProjectGroup[]>(
        `/api/orgs/${orgId}/integrations/${connId}/synced/projects`,
      )).data,
    enabled: !!orgId && !!connId,
    staleTime: 30_000,
  });
}

export function useSyncedTasks(
  orgId: string | null | undefined,
  connId: string | null | undefined,
  filters: {
    projectId?: string;
    search?: string;
    status?: string;
    versionId?: string;
    skip?: number;
    take?: number;
  } = {},
) {
  return useQuery({
    queryKey: ["synced-tasks", orgId, connId, filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.projectId) params.projectId = filters.projectId;
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.versionId) params.versionId = filters.versionId;
      if (filters.skip) params.skip = filters.skip;
      if (filters.take) params.take = filters.take;
      const { data } = await api.get<{ total: number; items: SyncedTaskItem[] }>(
        `/api/orgs/${orgId}/integrations/${connId}/synced`,
        { params },
      );
      return data;
    },
    enabled: !!orgId && !!connId,
    staleTime: 15_000,
  });
}

export function useSyncedVersions(
  orgId: string | null | undefined,
  connId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["synced-versions", orgId, connId],
    queryFn: async () =>
      (await api.get<SyncedVersionItem[]>(
        `/api/orgs/${orgId}/integrations/${connId}/synced/versions`,
      )).data,
    enabled: !!orgId && !!connId,
    staleTime: 60_000,
  });
}
