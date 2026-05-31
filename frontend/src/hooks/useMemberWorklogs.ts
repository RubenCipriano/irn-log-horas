"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { WorklogItem } from "@/lib/types";

// Per-user worklog stream feeding the mini-calendar on /members/{userId}.
// Mirrors useWorklogs shape but hits the per-member endpoint:
// the caller-scoped /worklogs handler silently coerces target=caller for
// insufficient roles, so the dedicated route is the audit-friendlier gate.
export function useMemberWorklogs(
  orgId: string | null | undefined,
  userId: string | null | undefined,
  from: string,
  to: string,
  projectId?: string | null,
) {
  return useQuery({
    queryKey: ["member-worklogs", orgId, userId, from, to, projectId ?? null],
    queryFn: async () => {
      const params: Record<string, string> = { from, to };
      if (projectId) params.projectId = projectId;
      const { data } = await api.get<WorklogItem[]>(
        `/api/orgs/${orgId}/members/${userId}/worklogs`,
        { params },
      );
      return data;
    },
    enabled: !!orgId && !!userId && !!from && !!to,
    staleTime: 30_000,
  });
}
