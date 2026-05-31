"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OrgRole, WorklogItem } from "@/lib/types";

// Mirrors backend MemberSummaryResponse. Fields tagged "nullable when
// the caller lacks the gate" mean: 200 still returns, just with that
// section blanked — the directory entry stays visible to Viewers even
// when the hours block is hidden.

export type PayCadence = "hourly" | "daily" | "monthly";

export type MemberProfile = {
  id: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
  // Compensation block. All four fields nulled together for viewers
  // without BillingRead. payCadence null => treat as 'hourly' for legacy
  // memberships that pre-date the cadence column.
  payCadence: PayCadence | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  monthlyRate: number | null;
};

export type MemberProjectMembership = {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  roleOnProject: string;
  // Null when the viewer lacks BillingRead OR no rate is set on the
  // project / inherited from an ancestor.
  billRate: number | null;
  costPerHour: number | null;
  joinedAt: string;
};

export type MemberWorkSummary = {
  hoursLogged: number;
  hoursExpected: number;
  deficit: number;
  billableHours: number;
  // Hours that contribute to hoursLogged but have no cost rate (no project
  // allocation, no org-level fallback). Frontend warns the paycheck is
  // partial when this is > 0.
  hoursUnrated: number;
  // Billing-side sibling of hoursUnrated: billable hours we couldn't price
  // because no bill_rate cascade hit. Excluded from `revenue`. Always
  // present (defaults to 0 on pre-deploy cache entries).
  billableHoursUnrated: number;
  // Null when viewer lacks BillingRead. Distinct from a 0 value.
  paycheck: number | null;
  billed: number | null;
  // Sum of billable_hours × effective bill_rate for the month. Same gate
  // as paycheck/billed — null when viewer lacks BillingRead.
  revenue: number | null;
  // Cadence-aware paycheck shape. Null when viewer lacks BillingRead.
  //   hourly  -> 'hours'             paycheck = Σ(hours × cost_per_hour)
  //   daily   -> 'distinctWorkdays'  paycheck = distinct_workdays × daily_rate
  //   monthly -> 'monthlyProRated'   paycheck = monthly_rate × (logged / expected)
  // Daily / monthly bypass the per-project cost_per_hour override entirely
  // (the override only applies under the hourly cadence).
  paycheckCadence: PayCadence | null;
  paycheckBasis: "hours" | "distinctWorkdays" | "monthlyProRated" | null;
};

export type MemberPerProjectRow = {
  projectId: string;
  projectName: string;
  hours: number;
  billableHours: number;
  paycheck: number | null;
  // Per-project revenue subtotal. Nulled together with paycheck under
  // the same BillingRead gate.
  revenue: number | null;
  // Weighted-avg effective bill rate (revenue / billable hours) — blends
  // frozen invoice-line snapshots with the current cascade for unbilled
  // hours, so it matches what `revenue` divides by. Null when no priced
  // billable hours.
  effectiveBillRate: number | null;
};

export type MemberSummaryResponse = {
  member: MemberProfile;
  projectMemberships: MemberProjectMembership[];
  workSummary: MemberWorkSummary | null;
  perProject: MemberPerProjectRow[] | null;
  recentWorklogs: WorklogItem[] | null;
  from: string;
  to: string;
};

// /api/orgs/{id}/members/{userId}/summary?month=YYYY-MM
// Single rolled-up payload for the /members/{userId} page. Sections come
// back null when the caller lacks the gate (work block: WorklogsReadOrg
// or self; billing fields: BillingRead).
export function useMemberSummary(
  orgId: string | null | undefined,
  userId: string | null | undefined,
  // ISO YYYY-MM. Omit / null => server picks current calendar month.
  monthIso: string | null | undefined,
) {
  return useQuery({
    queryKey: ["member-summary", orgId, userId, monthIso ?? "current"],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (monthIso) params.month = monthIso;
      const { data } = await api.get<MemberSummaryResponse>(
        `/api/orgs/${orgId}/members/${userId}/summary`,
        { params },
      );
      return data;
    },
    enabled: !!orgId && !!userId,
    staleTime: 30_000,
  });
}
