"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProjectItem } from "@/lib/types";

export type ProjectChildItem = {
  id: string;
  name: string;
  code: string | null;
  type: string; // "project" | "subproject" | "integration" | "team" | …
  archived: boolean;
  connectionId: string | null;
  upstreamProjectId: string | null;
  taskCount: number;
  childProjectCount: number;
};

// Direct children of `projectId`. Used by the project detail page's
// "Projetos" tab to render the sub-tree one level at a time.
export function useProjectChildren(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["project-children", orgId, projectId],
    queryFn: async () =>
      (await api.get<ProjectChildItem[]>(
        `/api/orgs/${orgId}/projects/${projectId}/children`,
      )).data,
    enabled: !!orgId && !!projectId,
    staleTime: 30_000,
  });
}

export function useProjects(orgId: string | null | undefined, includeArchived = false) {
  return useQuery({
    queryKey: ["projects", orgId, includeArchived],
    queryFn: async () => {
      const { data } = await api.get<ProjectItem[]>(
        `/api/orgs/${orgId}/projects`,
        { params: includeArchived ? { includeArchived: true } : {} },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export type CreateProjectPayload = {
  name: string;
  code?: string;
  billRate?: number;
  // Billing-party fields (Client collapsed into Project).
  contactEmail?: string;
  contactName?: string;
  taxId?: string;
  address?: string;
  defaultBillRate?: number;
};

export function useCreateProject(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateProjectPayload) =>
      (await api.post<ProjectItem>(`/api/orgs/${orgId}/projects`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
      qc.invalidateQueries({ queryKey: ["projects-unified", orgId] });
    },
  });
}

export type UpdateProjectPatch = {
  name?: string;
  code?: string | null;
  archived?: boolean;
  billRate?: number;
  clearBillRate?: boolean;
  contactEmail?: string | null;
  contactName?: string | null;
  taxId?: string | null;
  address?: string | null;
  defaultBillRate?: number;
  clearDefaultBillRate?: boolean;
};

export function useUpdateProject(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      patch,
    }: {
      projectId: string;
      patch: UpdateProjectPatch;
    }) =>
      (await api.patch<ProjectItem>(`/api/orgs/${orgId}/projects/${projectId}`, patch)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
      qc.invalidateQueries({ queryKey: ["projects-unified", orgId] });
    },
  });
}

export function useDeleteProject(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) =>
      (await api.delete<{ ok: boolean; detachedWorklogs: number }>(
        `/api/orgs/${orgId}/projects/${projectId}`,
      )).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", orgId] });
      qc.invalidateQueries({ queryKey: ["projects-unified", orgId] });
    },
  });
}
