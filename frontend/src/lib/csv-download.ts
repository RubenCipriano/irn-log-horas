import { api } from "@/lib/api";

// Shared helper for the worklogs CSV export endpoint. Both ReportsView
// (org-wide range) and MemberDetailView (single member / month) hit the
// same GET /api/orgs/{orgId}/worklogs/export.csv — keeping the blob →
// object-URL → hidden anchor → revoke dance in one place so the two
// callers don't drift on response handling or filename quoting.
//
// The endpoint already accepts ?userId= with the right permission shape
// (route gate WorklogsReadOwn; handler Forbid() when userId != caller &&
// !WorklogsReadOrg), so no per-caller branching is needed here.

export type DownloadWorklogsCsvOptions = {
  orgId: string;
  from: string; // yyyy-MM-dd
  to: string; // yyyy-MM-dd
  userId?: string;
  filename: string;
};

export async function downloadWorklogsCsv(
  opts: DownloadWorklogsCsvOptions,
): Promise<void> {
  const params: Record<string, string> = { from: opts.from, to: opts.to };
  if (opts.userId) params.userId = opts.userId;

  const resp = await api.get(`/api/orgs/${opts.orgId}/worklogs/export.csv`, {
    params,
    responseType: "blob",
  });
  const blob = new Blob([resp.data as Blob], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
