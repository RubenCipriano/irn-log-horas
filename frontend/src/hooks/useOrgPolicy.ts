"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PolicyResponse } from "@/lib/types";

// Read + patch /api/orgs/{id}/policy. Both fields are JSON-strings on
// the wire; this hook keeps that opaque — the editor view parses /
// stringifies. The PATCH body uses tri-state booleans (setSchedule /
// setHolidays) so callers can update one without touching the other.

export function useOrgPolicy(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["org-policy", orgId],
    queryFn: async () =>
      (await api.get<PolicyResponse>(`/api/orgs/${orgId}/policy`)).data,
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export type UpdatePolicyPayload = {
  setSchedule?: boolean;
  scheduleConfig?: string | null;
  setHolidays?: boolean;
  holidayProfile?: string | null;
};

export function useUpdateOrgPolicy(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdatePolicyPayload) =>
      (await api.patch<PolicyResponse>(`/api/orgs/${orgId}/policy`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-policy", orgId] });
      qc.invalidateQueries({ queryKey: ["expected", orgId] });
      qc.invalidateQueries({ queryKey: ["holidays", orgId] });
    },
  });
}
