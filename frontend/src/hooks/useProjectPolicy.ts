"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProjectPolicyResponse } from "@/lib/types";

// Per-project policy overrides. Tri-state PATCH mirrors the org policy
// endpoint: omit a Set* flag to leave a field untouched, send Set*=true
// with null to clear the local override (revert to inherited).

export function useProjectPolicy(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["project-policy", orgId, projectId],
    queryFn: async () =>
      (await api.get<ProjectPolicyResponse>(
        `/api/orgs/${orgId}/projects/${projectId}/policy`,
      )).data,
    enabled: !!orgId && !!projectId,
    staleTime: 2 * 60_000,
  });
}

export type UpdateProjectPolicyPayload = {
  setSchedule?: boolean;
  scheduleConfig?: string | null;
  setHolidays?: boolean;
  holidayProfile?: string | null;
  setHolidayCountry?: boolean;
  holidayCountry?: string | null;
};

export function useUpdateProjectPolicy(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateProjectPolicyPayload) =>
      (await api.patch<ProjectPolicyResponse>(
        `/api/orgs/${orgId}/projects/${projectId}/policy`,
        payload,
      )).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-policy", orgId, projectId] });
      // Calendar reads expected hours + holidays scoped to the project —
      // any change here invalidates those views too.
      qc.invalidateQueries({ queryKey: ["expected", orgId] });
      qc.invalidateQueries({ queryKey: ["holidays", orgId] });
      qc.invalidateQueries({ queryKey: ["projects-unified", orgId] });
    },
  });
}
