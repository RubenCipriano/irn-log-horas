"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MemberItem, OrgRole } from "@/lib/types";

// 'hourly' is the default when the server returns NULL — back-compat with
// pre-cadence rows. UI normalises null -> 'hourly' on read; writes are
// always explicit.
export type PayCadence = "hourly" | "daily" | "monthly";

export type MemberCompensationPayload = {
  cadence: PayCadence;
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlyRate: number | null;
};

export function useMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", orgId],
    queryFn: async () => (await api.get<MemberItem[]>(`/api/orgs/${orgId}/members`)).data,
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useAddMember(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { email: string; role: OrgRole }) =>
      (await api.post<MemberItem>(`/api/orgs/${orgId}/members`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}

export function useChangeRole(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: OrgRole }) =>
      (await api.patch(`/api/orgs/${orgId}/members/${userId}`, { role })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}

// Updates a member's cost rate. Pass `costPerHour: null` to clear (via
// the `clearCost: true` body flag); pass a number to set / change.
export function useUpdateMemberCost(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, costPerHour }: { userId: string; costPerHour: number | null }) =>
      (await api.patch(`/api/orgs/${orgId}/members/${userId}`,
        costPerHour === null
          ? { clearCost: true }
          : { costPerHour })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}

// Single source of truth for member compensation. Atomically writes the
// cadence + all three rate slots so that toggling cadence on the client
// preserves the other-slot values for next time.
export function useUpdateMemberCompensation(
  orgId: string | null | undefined,
  userId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: MemberCompensationPayload) =>
      (
        await api.patch(
          `/api/orgs/${orgId}/members/${userId}/compensation`,
          payload,
        )
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", orgId] });
      qc.invalidateQueries({ queryKey: ["member-summary", orgId, userId] });
    },
  });
}

export function useRemoveMember(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await api.delete(`/api/orgs/${orgId}/members/${userId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}

export function useTransferOwnership(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { newOwnerId: string; password: string }) =>
      (await api.post(`/api/orgs/${orgId}/transfer`, payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", orgId] });
      qc.invalidateQueries({ queryKey: ["orgs"] });
    },
  });
}
