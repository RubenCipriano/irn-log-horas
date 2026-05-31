"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ExpectedHoursResponse, HolidaysResponse, WorklogItem } from "@/lib/types";

// Worklog reads/writes are scoped to the caller's user in the given
// org. Keys include `from`/`to` so switching months produces a fresh
// fetch rather than a stale cache hit.

export function useWorklogs(
  orgId: string | null | undefined,
  from: string,
  to: string,
  projectId?: string | null,
) {
  return useQuery({
    queryKey: ["worklogs", orgId, from, to, projectId ?? null],
    queryFn: async () => {
      const params: Record<string, string> = { from, to };
      if (projectId) params.projectId = projectId;
      const { data } = await api.get<WorklogItem[]>(
        `/api/orgs/${orgId}/worklogs`,
        { params },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
    // Auto-poll while any row is mid-push so the badge flips
    // pending → pushed/failed without a manual refresh.
    refetchInterval: (q) => {
      const data = q.state.data as WorklogItem[] | undefined;
      if (!data) return false;
      const live = data.some((w) => w.pushStatus === "pending");
      return live ? 3000 : false;
    },
  });
}

export function useExpectedHours(
  orgId: string | null | undefined,
  from: string,
  to: string,
  projectId?: string | null,
) {
  return useQuery({
    queryKey: ["expected", orgId, from, to, projectId ?? "org"],
    queryFn: async () => {
      const params: Record<string, string> = { from, to };
      if (projectId) params.projectId = projectId;
      const { data } = await api.get<ExpectedHoursResponse>(
        `/api/orgs/${orgId}/policy/expected-hours`,
        { params },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 10 * 60_000, // schedule rarely changes
  });
}

export function useHolidays(
  orgId: string | null | undefined,
  year: number,
  projectId?: string | null,
) {
  return useQuery({
    queryKey: ["holidays", orgId, year, projectId ?? "org"],
    queryFn: async () => {
      const params: Record<string, string | number> = { year };
      if (projectId) params.projectId = projectId;
      const { data } = await api.get<HolidaysResponse>(
        `/api/orgs/${orgId}/policy/holidays`,
        { params },
      );
      return data;
    },
    enabled: !!orgId,
    staleTime: 60 * 60_000, // holidays change once a year
  });
}

export type CreateWorklogPayload = {
  // Exactly one of (projectId, upstreamTaskId) must be set. Backend
  // rejects both-or-neither with 400. Upstream variant also kicks off
  // a Hangfire push job — see WorklogPushJob.cs.
  projectId?: string | null;
  taskId?: string | null;
  upstreamTaskId?: string | null;
  workDate: string;
  hours: number;
  notes?: string;
  // Null / omitted = backend decides the default based on project ↔
  // client link. Pass explicit true/false to override.
  isBillable?: boolean;
};

export function useCreateWorklog(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateWorklogPayload) =>
      (await api.post<WorklogItem>(`/api/orgs/${orgId}/worklogs`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worklogs", orgId] });
    },
  });
}

export function useDeleteWorklog(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (worklogId: string) =>
      (await api.delete(`/api/orgs/${orgId}/worklogs/${worklogId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worklogs", orgId] });
    },
  });
}
