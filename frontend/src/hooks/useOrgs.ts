"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OrgDetail, OrgListItem } from "@/lib/types";

export function useMyOrgs() {
  return useQuery({
    queryKey: ["orgs"],
    queryFn: async () => (await api.get<OrgListItem[]>("/api/orgs")).data,
    staleTime: 60_000,
  });
}

export function useOrg(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["orgs", orgId],
    queryFn: async () => (await api.get<OrgDetail>(`/api/orgs/${orgId}`)).data,
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api.post<OrgListItem>("/api/orgs", { name })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}

// Hard org delete — triple-gate (Owner role + name confirm + password).
// On success the SPA should drop into a redirect: useMyOrgs no longer
// includes this id, so the AppShell picks another or routes to onboarding.
export function useDeleteOrg(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { confirmName: string; password: string }) =>
      (await api.delete(`/api/orgs/${orgId}`, { data: body })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}
