"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type RoleOnProject = "viewer" | "developer" | "tech_lead" | "manager";

export const ROLE_ON_PROJECT_OPTIONS: { value: RoleOnProject; label: string }[] = [
  { value: "viewer", label: "Visualizador" },
  { value: "developer", label: "Programador" },
  { value: "tech_lead", label: "Tech Lead" },
  { value: "manager", label: "Manager" },
];

export type MemberAllocationItem = {
  projectId: string;
  projectName: string;
  costPerHour: number | null;
  allocatedAt: string;
};

export type ProjectMemberItem = {
  userId: string;
  email: string;
  name: string;
  roleOnProject: RoleOnProject;
  denied: boolean;
  // Same numeric field drives cost reports AND invoice rate — cost = bill
  // in v1's consulting model.
  costPerHour: number | null;
  allocatedAt: string;
};

// What projects is this user allocated to?
export function useMemberAllocations(
  orgId: string | null | undefined,
  userId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["member-allocations", orgId, userId],
    queryFn: async () =>
      (await api.get<MemberAllocationItem[]>(
        `/api/orgs/${orgId}/members/${userId}/allocations`,
      )).data,
    enabled: !!orgId && !!userId,
    staleTime: 60_000,
  });
}

// Who is allocated to this project?
export function useProjectMembers(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["project-members", orgId, projectId],
    queryFn: async () =>
      (await api.get<ProjectMemberItem[]>(
        `/api/orgs/${orgId}/projects/${projectId}/members`,
      )).data,
    enabled: !!orgId && !!projectId,
    staleTime: 30_000,
  });
}

export type AllocateProjectMemberPayload = {
  userId: string;
  roleOnProject?: RoleOnProject;
  costPerHour?: number;
  denied?: boolean;
};

export function useAllocateProjectMember(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AllocateProjectMemberPayload) =>
      (await api.post(`/api/orgs/${orgId}/projects/${projectId}/members`, payload)).data,
    onSuccess: () => invalidateMemberCaches(qc, orgId, projectId),
  });
}

export type UpdateProjectMemberPayload = {
  userId: string;
  roleOnProject?: RoleOnProject;
  costPerHour?: number | null; // null => clearCost
  denied?: boolean;
};

export function useUpdateProjectMember(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, costPerHour, ...rest }: UpdateProjectMemberPayload) => {
      // Build the PATCH body from defined-only fields. `null` on
      // costPerHour means "clear it" (distinct from "omit it").
      const body: Record<string, unknown> = { ...rest };
      if (costPerHour === null) body.clearCost = true;
      else if (typeof costPerHour === "number") body.costPerHour = costPerHour;
      return (await api.patch(
        `/api/orgs/${orgId}/projects/${projectId}/members/${userId}`,
        body,
      )).data;
    },
    onSuccess: () => invalidateMemberCaches(qc, orgId, projectId),
  });
}

export function useUnallocateProjectMember(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await api.delete(`/api/orgs/${orgId}/projects/${projectId}/members/${userId}`)).data,
    onSuccess: () => invalidateMemberCaches(qc, orgId, projectId),
  });
}

function invalidateMemberCaches(
  qc: ReturnType<typeof useQueryClient>,
  orgId: string | null | undefined,
  projectId: string | null | undefined,
) {
  qc.invalidateQueries({ queryKey: ["project-members", orgId, projectId] });
  // Match-any-userId — `member-allocations` queries are keyed
  // `["member-allocations", orgId, userId]`; the prefix catches every
  // member's allocations cache.
  qc.invalidateQueries({ queryKey: ["member-allocations"] });
  qc.invalidateQueries({ queryKey: ["members", orgId] });
  // The project detail page reads `["project", orgId, projectId]`.
  qc.invalidateQueries({ queryKey: ["project", orgId, projectId] });
}
