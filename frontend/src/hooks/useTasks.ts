"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type TaskItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function useTasks(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
  options?: { includeDescendants?: boolean },
) {
  const includeDescendants = options?.includeDescendants ?? false;
  return useQuery({
    queryKey: ["tasks", orgId, projectId, includeDescendants],
    queryFn: async () => {
      const params = includeDescendants ? { includeDescendants: true } : undefined;
      return (await api.get<TaskItem[]>(
        `/api/orgs/${orgId}/projects/${projectId}/tasks`,
        { params },
      )).data;
    },
    enabled: !!orgId && !!projectId,
    staleTime: 30_000,
  });
}

export function useCreateTask(orgId: string | null | undefined, projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { title: string; description?: string; status?: string }) =>
      (await api.post<TaskItem>(`/api/orgs/${orgId}/projects/${projectId}/tasks`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", orgId, projectId] }),
  });
}

export function useUpdateTask(orgId: string | null | undefined, projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      patch,
    }: {
      taskId: string;
      patch: { title?: string; description?: string; status?: string; setAssignee?: boolean; assigneeId?: string | null };
    }) =>
      (await api.patch<TaskItem>(`/api/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", orgId, projectId] }),
  });
}

export function useDeleteTask(orgId: string | null | undefined, projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) =>
      (await api.delete(`/api/orgs/${orgId}/projects/${projectId}/tasks/${taskId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", orgId, projectId] }),
  });
}
