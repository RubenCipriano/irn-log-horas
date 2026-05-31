"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type HoursSummaryProjectRow = {
  kind: "native" | "upstream";
  projectId: string | null;       // native projects only
  connectionId: string | null;    // upstream only
  upstreamProjectId: string | null;
  projectName: string;
  hours: number;
  costPerHour: number | null;     // null for non-managers OR no rate
  cost: number | null;
};

export type HoursSummaryResponse = {
  from: string;
  to: string;
  totalHours: number;
  costPerHour: number | null;
  totalCost: number | null;
  byProject: HoursSummaryProjectRow[];
};

export function useMemberHours(
  orgId: string | null | undefined,
  userId: string | null | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  return useQuery({
    queryKey: ["member-hours", orgId, userId, from, to],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await api.get<HoursSummaryResponse>(
        `/api/orgs/${orgId}/members/${userId}/hours-summary`,
        { params },
      );
      return data;
    },
    enabled: !!orgId && !!userId,
    staleTime: 60_000,
  });
}
