"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Unified row used by the /tasks page. `kind` is the discriminator; the
// other fields are the union of native + upstream so the table can show
// a single row shape regardless of source.
export type UnifiedTaskItem = {
  kind: "native" | "upstream";
  id: string; // Guid for native, "{connId:N}:{rowId:N}" for upstream
  nativeProjectId: string | null;
  connectionId: string | null;
  upstreamProjectId: string | null;
  upstreamId: string | null;
  title: string;
  description: string | null;
  status: string;
  nativeAssigneeId: string | null;
  assigneeUpstreamId: string | null;
  upstreamVersionId: string | null;
  upstreamVersionName: string | null;
  updatedAt: string;
};

export type AllTasksFilters = {
  search?: string;
  status?: string;
  versionId?: string;
  nativeProjectId?: string;
  connectionId?: string;
  upstreamProjectId?: string;
  skip?: number;
  take?: number;
};

export function useAllTasks(orgId: string | null | undefined, filters: AllTasksFilters = {}) {
  return useQuery({
    queryKey: ["all-tasks", orgId, filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.versionId) params.versionId = filters.versionId;
      if (filters.nativeProjectId) params.nativeProjectId = filters.nativeProjectId;
      if (filters.connectionId) params.connectionId = filters.connectionId;
      if (filters.upstreamProjectId) params.upstreamProjectId = filters.upstreamProjectId;
      if (filters.skip) params.skip = filters.skip;
      if (filters.take) params.take = filters.take;
      const { data } = await api.get<{ total: number; items: UnifiedTaskItem[] }>(
        `/api/orgs/${orgId}/tasks`,
        { params },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 15_000,
  });
}

export type CreateTaskBody = {
  kind: "native" | "upstream";
  nativeProjectId?: string;
  connectionId?: string;
  upstreamProjectId?: string;
  title: string;
  description?: string;
  status?: string;
  nativeAssigneeId?: string;
  assigneeUpstreamId?: string;
  upstreamVersionId?: string;
};

export function useCreateAnyTask(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTaskBody) =>
      (await api.post<UnifiedTaskItem>(`/api/orgs/${orgId}/tasks`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-tasks", orgId] }),
  });
}

export type UpdateTaskBody = {
  title?: string;
  description?: string;
  status?: string;
  setNativeAssignee?: boolean;
  nativeAssigneeId?: string | null;
  assigneeUpstreamId?: string;
  upstreamVersionId?: string;
};

export function useUpdateAnyTask(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, body }: { taskId: string; body: UpdateTaskBody }) =>
      (await api.patch<UnifiedTaskItem>(`/api/orgs/${orgId}/tasks/${encodeURIComponent(taskId)}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-tasks", orgId] }),
  });
}

export function useDeleteAnyTask(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) =>
      (await api.delete(`/api/orgs/${orgId}/tasks/${encodeURIComponent(taskId)}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-tasks", orgId] }),
  });
}
