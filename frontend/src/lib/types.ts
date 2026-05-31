// Frontend mirrors of the backend DTOs. Centralised so a contract
// change shows up as a TypeScript error in every caller, not as a
// runtime "undefined.foo" later.

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
  defaultOrgId: string | null;
  createdAt: string;
};

export type OrgListItem = {
  id: string;
  name: string;
  role: OrgRole;
  createdAt: string;
};

export type OrgDetail = {
  id: string;
  name: string;
  ownerId: string;
  yourRole: OrgRole;
  createdAt: string;
  updatedAt: string;
};

export type OrgRole = "owner" | "admin" | "manager" | "tech_lead" | "developer" | "viewer";

export type MemberItem = {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
  // Null when the rate isn't set OR the viewer is below Manager. The
  // backend strips this for non-managers, so a null here can mean either
  // "no rate" or "you're not allowed to see it" — same UI treatment.
  costPerHour: number | null;
};

export type ProjectItem = {
  id: string;
  name: string;
  code: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  billRate: number | null;
  // Billing-party fields (absorbed from the legacy Client entity).
  contactEmail: string | null;
  contactName: string | null;
  taxId: string | null;
  address: string | null;
  defaultBillRate: number | null;
};

export type WorklogPushStatus = "none" | "pending" | "pushed" | "failed";

export type WorklogItem = {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  upstreamTaskId: string | null;
  // Denormalised by the backend (LEFT JOIN to upstream_tasks). Lets
  // the calendar filter by upstream project without a per-row lookup.
  upstreamProjectId: string | null;
  workDate: string; // ISO YYYY-MM-DD
  hours: number;
  notes: string | null;
  source: string | null;
  pushStatus: WorklogPushStatus;
  upstreamWorklogId: string | null;
  pushErrorCode: string | null;
  createdAt: string;
  isBillable: boolean;
  // Derived: "non_billable" | "billable" | "billed". The badge UX picks
  // its colour from this directly.
  billingStatus: "non_billable" | "billable" | "billed";
};

export type UnifiedProjectItem = {
  // Synthetic id ("native:{guid}" or "upstream:{connId}:{upstreamId}")
  // so the SPA can use one keyspace.
  id: string;
  kind: "native" | "upstream";
  name: string;
  code: string | null;
  archived: boolean;
  nativeProjectId: string | null;
  connectionId: string | null;
  upstreamProjectId: string | null;
  provider: string | null;
  connectionName: string | null;
};

export type ExpectedHoursDay = { date: string; hours: number };
export type ExpectedHoursResponse = {
  from: string;
  to: string;
  total: number;
  days: ExpectedHoursDay[];
};

export type HolidayItem = { date: string; name: string; region: string };
export type HolidaysResponse = { year: number; holidays: HolidayItem[] };

export type PolicyResponse = {
  scheduleConfig: string | null;
  holidayProfile: string | null;
  updatedAt: string;
};

// Per-project policy overrides. Mirrors the org policy shape but every
// field is independently nullable — NULL means "inherit from nearest
// ancestor that sets it, else org, else built-in default". The sibling
// `effective` block tells the editor which source the calendar is
// currently resolving against (so the UI can show an "Inherited from
// {ancestor name}" badge per field).
export type EffectivePolicyBlock = {
  scheduleConfig: string | null;
  scheduleSource: string;
  scheduleSourceName: string | null;
  holidayProfile: string | null;
  holidaySource: string;
  holidaySourceName: string | null;
  holidayCountry: string | null;
  holidayCountrySource: string;
  holidayCountrySourceName: string | null;
};

export type ProjectPolicyResponse = {
  projectId: string;
  projectName: string;
  scheduleConfig: string | null;
  holidayProfile: string | null;
  holidayCountry: string | null;
  updatedAt: string;
  effective: EffectivePolicyBlock;
};

export type HolidayCountryItem = {
  code: string; // ISO-3166-1 alpha-2
  presetKey: string;
  displayName: string;
};

export type IntegrationConnectionItem = {
  id: string;
  provider: "openproject" | "jira" | "linear" | "gitlab";
  name: string;
  upstreamUserId: string | null;
  upstreamUserName: string | null;
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  createdAt: string;
  // Owning (project, member) tuple — one connection per (project, user,
  // provider) tuple after the Client collapse.
  projectId: string;
  projectName: string | null;
  userId: string;
  userName: string | null;
};

export type SyncJobItem = {
  id: string;
  connectionId: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progressTotal: number;
  progressDone: number;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
