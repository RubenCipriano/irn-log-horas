"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { IntegrationConnectionItem, SyncJobItem } from "@/lib/types";

export type IntegrationProvider = "openproject" | "jira" | "linear" | "gitlab";

export type CreateIntegrationPayload = {
  provider: IntegrationProvider;
  name: string;
  // The engagement project this connection belongs to. The owning user is
  // the caller (server-side enforced). Caller must already be a member
  // of the project — 403 `not_project_member` otherwise.
  projectId: string;
  baseUrl?: string;
  token?: string;
  email?: string;
};

export function useIntegrations(
  orgId: string | null | undefined,
  options?: { projectId?: string },
) {
  return useQuery({
    queryKey: ["integrations", orgId, options?.projectId ?? null],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (options?.projectId) params.projectId = options.projectId;
      return (
        await api.get<IntegrationConnectionItem[]>(`/api/orgs/${orgId}/integrations`, { params })
      ).data;
    },
    enabled: !!orgId,
    // Sync runs invalidate this — short stale time lets the polling
    // status badge feel live.
    staleTime: 15_000,
  });
}

export function useCreateIntegration(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateIntegrationPayload) =>
      (await api.post<IntegrationConnectionItem>(`/api/orgs/${orgId}/integrations`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", orgId] }),
  });
}

export function useTestIntegration(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connId: string) =>
      (await api.post<{ ok: boolean; lastVerifiedAt?: string }>(`/api/orgs/${orgId}/integrations/${connId}/test`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", orgId] }),
  });
}

export function useDeleteIntegration(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connId: string) =>
      (await api.delete(`/api/orgs/${orgId}/integrations/${connId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", orgId] }),
  });
}

export function useEnqueueSync(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: string | { connId: string; full?: boolean }) => {
      const connId = typeof args === "string" ? args : args.connId;
      const full = typeof args === "string" ? false : !!args.full;
      return (
        await api.post<{ reused: boolean; job: SyncJobItem }>(
          `/api/orgs/${orgId}/integrations/${connId}/sync`,
          null,
          { params: full ? { full: true } : {} },
        )
      ).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-jobs", orgId] }),
  });
}

export function useSyncJobs(
  orgId: string | null | undefined,
  options?: { connectionId?: string; limit?: number; pollMs?: number },
) {
  return useQuery({
    queryKey: ["sync-jobs", orgId, options?.connectionId, options?.limit],
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if (options?.connectionId) params.connectionId = options.connectionId;
      if (options?.limit) params.limit = options.limit;
      return (await api.get<SyncJobItem[]>(`/api/orgs/${orgId}/sync-jobs`, { params })).data;
    },
    enabled: !!orgId,
    // Refresh while any job is running so the progress bar advances.
    refetchInterval: (q) => {
      const data = q.state.data as SyncJobItem[] | undefined;
      if (!data) return false;
      const live = data.some((j) => j.status === "queued" || j.status === "running");
      return live ? options?.pollMs ?? 2000 : false;
    },
    staleTime: 5_000,
  });
}
