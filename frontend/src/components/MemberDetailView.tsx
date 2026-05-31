"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarMonthGrid } from "@/components/CalendarMonthGrid";
import { CompensationCard } from "@/components/CompensationCard";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useMemberSummary } from "@/hooks/useMemberSummary";
import { useMemberWorklogs } from "@/hooks/useMemberWorklogs";
import { useOrg } from "@/hooks/useOrgs";
import { useExpectedHours, useHolidays } from "@/hooks/useWorklogs";
import {
  groupByDate,
  indexByDate,
  monthDateRange,
  startOfMonth,
} from "@/lib/calendar-grid";
import { downloadWorklogsCsv } from "@/lib/csv-download";
import type {
  MemberProjectMembership,
  MemberPerProjectRow,
} from "@/hooks/useMemberSummary";
import type { OrgRole, WorklogItem } from "@/lib/types";

// Single-member dashboard at /members/{userId}. Composed of:
//   * MemberHeader      — avatar, name, email, role badge, joined date
//   * SummaryCards      — hours logged / expected / billable / paycheck
//   * MemberCalendar    — read-only monthly grid for the picked month
//   * MembershipsTable  — projects the member is allocated to (+ rates)
//   * PerProjectTable   — hours-by-project for the selected month
//   * RecentWorklogs    — last entries from the summary payload
//
// Caller-bucket gating happens server-side: workSummary / perProject /
// recentWorklogs come back null when the viewer lacks WorklogsReadOrg,
// and billing-related fields are nulled below BillingRead. We render
// each block only when its data is present, no role probing client-side.
export function MemberDetailView({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const org = useOrg(orgId);

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const monthIso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const range = useMemo(() => monthDateRange(cursor), [cursor]);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  const summary = useMemberSummary(orgId, userId, monthIso);
  const worklogs = useMemberWorklogs(orgId, userId, range.from, range.to);
  // Manager+ can edit compensation. Mirrors the backend `MembersUpdateCost`
  // permission — hiding the pencil for lower roles is a UX nicety.
  const yourRole = org.data?.yourRole;
  const canEditCompensation =
    yourRole === "owner" || yourRole === "admin" || yourRole === "manager";
  // Org-level expected hours + holidays for the mini-calendar. We don't
  // narrow by project here — the member's overall denominator is the
  // org schedule.
  const expected = useExpectedHours(orgId, range.from, range.to, null);
  const holidays = useHolidays(orgId, cursor.getFullYear(), null);

  const logsByDay = useMemo(
    () => groupByDate(worklogs.data ?? []),
    [worklogs.data],
  );
  const expectedByDay = useMemo(
    () => indexByDate(expected.data?.days ?? []),
    [expected.data],
  );
  const holidaysByDay = useMemo(
    () => indexByDate(holidays.data?.holidays ?? []),
    [holidays.data],
  );

  if (!orgId) {
    return (
      <div className="p-6 text-sm text-(--color-muted)">
        {t("common.pickOrgFirst")}
      </div>
    );
  }

  if (summary.isLoading) {
    return (
      <div className="p-6 text-sm text-(--color-muted)">{t("common.loading")}</div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-3">
        <p className="text-sm text-(--color-muted)">{t("memberDetail.notFound")}</p>
        <Link href="/members" className="text-xs text-indigo-600 hover:underline">
          ← {t("memberDetail.back")}
        </Link>
      </div>
    );
  }

  const {
    member,
    projectMemberships,
    workSummary,
    perProject,
    recentWorklogs,
  } = summary.data;
  const hoursHidden = workSummary === null;
  // Both gates (paycheck and revenue) are flipped by the same server-side
  // `canSeeBilling` check — keep the client-side gate uniform so the cache
  // bucket (`viewerBucket` in MemberSummaryEndpoints) stays correct.
  const billingVisible =
    workSummary !== null && workSummary.paycheck !== null;
  const revenueVisible =
    workSummary !== null && workSummary.revenue !== null;
  // Compensation card visible to anyone who can see ANY rate field on the
  // member profile (server nulls all four under the same BillingRead gate).
  const compensationVisible =
    member.hourlyRate !== null ||
    member.dailyRate !== null ||
    member.monthlyRate !== null ||
    member.payCadence !== null ||
    canEditCompensation;
  // Per-project paycheck attribution only makes sense under hourly cadence
  // (decision 5: daily/monthly bypass the per-project cost_per_hour
  // override, so per-project rows would be a misleading even split).
  const activeCadence = member.payCadence ?? "hourly";
  const perProjectPaycheckVisible =
    billingVisible && activeCadence === "hourly";

  async function handleCsvExport() {
    if (!orgId || csvBusy) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const displayName = member.name || member.email;
      const yyyyMM = `${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const slug = slugForFilename(displayName) || member.id.slice(0, 8);
      await downloadWorklogsCsv({
        orgId,
        from: range.from,
        to: range.to,
        userId: member.id,
        filename: `member-${slug}-${yyyyMM}.csv`,
      });
    } catch {
      setCsvError(t("members.csv.error"));
    } finally {
      setCsvBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link
        href="/members"
        className="text-xs text-indigo-600 hover:underline inline-block"
      >
        ← {t("memberDetail.back")}
      </Link>

      <MemberHeader
        name={member.name || member.email}
        email={member.email}
        role={member.role}
        roleLabel={t(`members.role.${member.role}`)}
        joinedAt={member.joinedAt}
        joinedLabel={t("memberDetail.joined", {
          date: formatDate(member.joinedAt),
        })}
      />

      {hoursHidden ? (
        <div className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5">
          <p className="text-sm text-(--color-muted)">
            {t("memberDetail.gate.hoursHidden")}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-4">
            <header className="flex items-end justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-(--color-fg)">
                {t("memberDetail.section.work")}
              </h2>
              <div className="flex items-center gap-2">
                {csvError && (
                  <span className="text-xs text-rose-600 dark:text-rose-400">
                    {csvError}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCsvExport}
                  disabled={csvBusy}
                  aria-busy={csvBusy}
                  className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-1.5 text-xs font-medium hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {csvBusy
                    ? t("members.csv.exporting")
                    : t("members.csv.export")}
                </button>
              </div>
            </header>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label={t("memberDetail.stat.hoursLogged")}
                value={workSummary!.hoursLogged.toFixed(1)}
              />
              <Stat
                label={t("memberDetail.stat.hoursExpected")}
                value={workSummary!.hoursExpected.toFixed(1)}
              />
              <Stat
                label={t("memberDetail.stat.deficit")}
                value={fmtSignedHours(workSummary!.deficit)}
                tone={workSummary!.deficit < 0 ? "warn" : "ok"}
              />
              <Stat
                label={t("memberDetail.stat.billableHours")}
                value={workSummary!.billableHours.toFixed(1)}
              />
            </div>
            {workSummary!.hoursUnrated > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("memberDetail.stat.hoursUnrated", {
                  hours: workSummary!.hoursUnrated.toFixed(1),
                })}
              </p>
            )}
          </section>

          {compensationVisible && (
            <CompensationCard
              orgId={orgId}
              userId={userId}
              canEdit={canEditCompensation}
              payCadence={member.payCadence}
              hourlyRate={member.hourlyRate}
              dailyRate={member.dailyRate}
              monthlyRate={member.monthlyRate}
            />
          )}

          {billingVisible && (
            <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-4">
              <header>
                <h2 className="text-sm font-semibold text-(--color-fg)">
                  {t("memberDetail.section.paycheck")}
                </h2>
                <p className="text-xs text-(--color-muted) mt-1">
                  {t("memberDetail.paycheck.note")}
                </p>
              </header>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label={t("memberDetail.stat.paycheck")}
                  value={fmtMoney(workSummary!.paycheck)}
                />
                <Stat
                  label={t("memberDetail.stat.billed")}
                  value={fmtMoney(workSummary!.billed)}
                />
              </div>
              {workSummary!.hoursUnrated > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("memberDetail.paycheck.unratedHint")}
                </p>
              )}
            </section>
          )}

          {revenueVisible && (
            <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-4">
              <header className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-(--color-fg)">
                    {t("memberDetail.section.billing")}
                  </h2>
                  <p className="text-xs text-(--color-muted) mt-1">
                    {t("members.billing.section.note")}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Link
                    href={`/invoices/new?target=member&userId=${member.id}`}
                    className="rounded-md bg-indigo-600 text-white px-2.5 py-1 text-xs font-medium hover:bg-indigo-700"
                  >
                    {t("invoice.member.fromMemberCard")}
                  </Link>
                  <Link
                    href="/invoices"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    {t("members.billing.viewInvoices")}
                  </Link>
                </div>
              </header>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label={t("members.billing.stat.revenue")}
                  value={fmtMoney(workSummary!.revenue)}
                />
                <Stat
                  label={t("members.billing.stat.billableHoursUnrated")}
                  value={workSummary!.billableHoursUnrated.toFixed(1)}
                  tone={
                    workSummary!.billableHoursUnrated > 0 ? "warn" : undefined
                  }
                />
              </div>
              {workSummary!.billableHoursUnrated > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("members.billing.stat.billableHoursUnratedHint")}
                </p>
              )}
              {perProject && perProject.length > 0 && (
                <BillingPerProjectTable rows={perProject} t={t} />
              )}
            </section>
          )}

          <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-4">
            <header>
              <h2 className="text-sm font-semibold text-(--color-fg)">
                {t("memberDetail.section.calendar")}
              </h2>
            </header>
            <CalendarMonthGrid
              cursor={cursor}
              onCursorChange={setCursor}
              logsByDay={logsByDay}
              expectedByDay={expectedByDay}
              holidaysByDay={holidaysByDay}
              readOnly
            />
            {(worklogs.data ?? []).length === 0 && !worklogs.isLoading && (
              <p className="text-xs text-(--color-muted)">
                {t("memberDetail.calendar.empty")}
              </p>
            )}
          </section>

          {perProject && perProject.length > 0 && (
            <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
              <header>
                <h2 className="text-sm font-semibold text-(--color-fg)">
                  {t("memberDetail.section.byProject")}
                </h2>
              </header>
              <PerProjectTable
                rows={perProject}
                showPaycheck={perProjectPaycheckVisible}
                t={t}
              />
            </section>
          )}
        </>
      )}

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
        <header>
          <h2 className="text-sm font-semibold text-(--color-fg)">
            {t("memberDetail.section.projects")}
          </h2>
        </header>
        {projectMemberships.length === 0 ? (
          <p className="text-sm text-(--color-muted)">
            {t("memberDetail.projects.empty")}
          </p>
        ) : (
          <MembershipsTable
            rows={projectMemberships}
            showRates={billingVisible}
            t={t}
          />
        )}
      </section>

      {recentWorklogs && recentWorklogs.length > 0 && (
        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
          <header>
            <h2 className="text-sm font-semibold text-(--color-fg)">
              {t("memberDetail.section.recent")}
            </h2>
          </header>
          <RecentWorklogs rows={recentWorklogs} />
        </section>
      )}
    </div>
  );
}

function MemberHeader({
  name,
  email,
  role,
  roleLabel,
  joinedAt: _joinedAt,
  joinedLabel,
}: {
  name: string;
  email: string;
  role: OrgRole;
  roleLabel: string;
  joinedAt: string;
  joinedLabel: string;
}) {
  const initial = name[0]?.toUpperCase() ?? "?";
  return (
    <header className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 flex items-center gap-4">
      <div className="h-12 w-12 rounded-full bg-(--color-bg) border border-(--color-border) flex items-center justify-center text-sm font-semibold text-(--color-fg)">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-semibold text-(--color-fg) truncate">{name}</h1>
        <p className="text-sm text-(--color-muted) truncate">{email}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <RoleBadge role={role} label={roleLabel} />
          <span className="text-xs text-(--color-muted)">{joinedLabel}</span>
        </div>
      </div>
    </header>
  );
}

function RoleBadge({ role, label }: { role: OrgRole; label: string }) {
  const tone =
    role === "owner" || role === "admin"
      ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
      : role === "manager"
        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
        : role === "tech_lead"
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-(--color-bg) text-(--color-muted)";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-(--color-fg)";
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-3">
      <p className="text-[11px] uppercase tracking-wider text-(--color-muted)">
        {label}
      </p>
      <p className={`text-lg font-semibold mt-1 ${valueColor}`}>{value}</p>
    </div>
  );
}

function MembershipsTable({
  rows,
  showRates,
  t,
}: {
  rows: MemberProjectMembership[];
  showRates: boolean;
  t: (key: string) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-(--color-muted) text-left">
        <tr>
          <th className="font-medium pb-2">{t("memberDetail.projects.column.project")}</th>
          <th className="font-medium pb-2">{t("memberDetail.projects.column.role")}</th>
          {showRates && (
            <th className="font-medium pb-2 text-right">
              {t("memberDetail.projects.column.billRate")}
            </th>
          )}
          {showRates && (
            <th className="font-medium pb-2 text-right">
              {t("memberDetail.projects.column.costRate")}
            </th>
          )}
          <th className="font-medium pb-2 text-right">
            {t("memberDetail.projects.column.joined")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.projectId} className="border-t border-(--color-border)">
            <td className="py-1.5">
              <Link
                href={`/projects/${r.projectId}`}
                className="text-(--color-fg) hover:text-indigo-600"
              >
                {r.projectName}
                {r.projectCode && (
                  <span className="text-(--color-muted) text-xs ml-1">
                    ({r.projectCode})
                  </span>
                )}
              </Link>
            </td>
            <td className="py-1.5 text-(--color-muted) text-xs">{r.roleOnProject}</td>
            {showRates && (
              <td className="py-1.5 text-right font-mono text-xs">
                {r.billRate === null ? "—" : r.billRate.toFixed(2)}
              </td>
            )}
            {showRates && (
              <td className="py-1.5 text-right font-mono text-xs">
                {r.costPerHour === null ? "—" : r.costPerHour.toFixed(2)}
              </td>
            )}
            <td className="py-1.5 text-right text-xs text-(--color-muted)">
              {formatDate(r.joinedAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PerProjectTable({
  rows,
  showPaycheck,
  t,
}: {
  rows: MemberPerProjectRow[];
  showPaycheck: boolean;
  t: (key: string) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-(--color-muted) text-left">
        <tr>
          <th className="font-medium pb-2">
            {t("memberDetail.projects.column.project")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("memberDetail.stat.hoursLogged")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("memberDetail.stat.billableHours")}
          </th>
          {showPaycheck && (
            <th className="font-medium pb-2 text-right">
              {t("memberDetail.stat.paycheck")}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.projectId} className="border-t border-(--color-border)">
            <td className="py-1.5 truncate">
              <Link
                href={`/projects/${r.projectId}`}
                className="text-(--color-fg) hover:text-indigo-600"
              >
                {r.projectName}
              </Link>
            </td>
            <td className="py-1.5 text-right font-mono">{r.hours.toFixed(2)}</td>
            <td className="py-1.5 text-right font-mono">
              {r.billableHours.toFixed(2)}
            </td>
            {showPaycheck && (
              <td className="py-1.5 text-right font-mono">{fmtMoney(r.paycheck)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BillingPerProjectTable({
  rows,
  t,
}: {
  rows: MemberPerProjectRow[];
  t: (key: string) => string;
}) {
  // Footer total recomputed from row revenue rather than threaded down so
  // the table is self-contained; matches `workSummary.revenue` because the
  // server emits both from the same loop.
  const totalRevenue = rows.reduce(
    (acc, r) => acc + (r.revenue ?? 0),
    0,
  );
  const totalBillable = rows.reduce((acc, r) => acc + r.billableHours, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-(--color-muted) text-left">
        <tr>
          <th className="font-medium pb-2">
            {t("members.billing.table.project")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("members.billing.table.billableHours")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("members.billing.table.effectiveBillRate")}
          </th>
          <th className="font-medium pb-2 text-right">
            {t("members.billing.table.revenue")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.projectId} className="border-t border-(--color-border)">
            <td className="py-1.5 truncate">
              <Link
                href={`/projects/${r.projectId}`}
                className="text-(--color-fg) hover:text-indigo-600"
              >
                {r.projectName}
              </Link>
            </td>
            <td className="py-1.5 text-right font-mono">
              {r.billableHours.toFixed(2)}
            </td>
            <td className="py-1.5 text-right font-mono">
              {r.effectiveBillRate === null
                ? "—"
                : r.effectiveBillRate.toFixed(2)}
            </td>
            <td className="py-1.5 text-right font-mono">
              {fmtMoney(r.revenue)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-(--color-border) font-semibold">
          <td className="pt-2">{t("members.billing.table.total")}</td>
          <td className="pt-2 text-right font-mono">
            {totalBillable.toFixed(2)}
          </td>
          <td />
          <td className="pt-2 text-right font-mono">
            {totalRevenue.toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function RecentWorklogs({ rows }: { rows: WorklogItem[] }) {
  return (
    <ul className="divide-y divide-(--color-border)">
      {rows.map((w) => (
        <li
          key={w.id}
          className="py-2 flex items-start gap-3 text-xs"
        >
          <span className="font-mono text-(--color-fg) shrink-0 tabular-nums w-12">
            {w.hours.toFixed(1)}h
          </span>
          <span className="text-(--color-muted) shrink-0 w-24 tabular-nums">
            {w.workDate}
          </span>
          <span className="text-(--color-fg) flex-1 truncate">
            {w.notes ?? "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function fmtMoney(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(2);
}

function fmtSignedHours(v: number): string {
  const fixed = v.toFixed(1);
  if (v > 0) return `+${fixed}`;
  return fixed;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

// Filesystem-safe slug for CSV filenames. Lowercases, swaps whitespace for
// hyphens, strips everything outside [a-z0-9-]. Returns "" when the input
// has no alphanumerics — caller falls back to a userId substring so the
// filename is never just `member--YYYYMM.csv`.
function slugForFilename(name: string): string {
  // NFKD decomposes accented chars into base + combining mark, and the
  // subsequent [^a-z0-9-] filter strips the combining marks naturally —
  // so "João" → "joao" without a fragile combining-mark range literal in
  // the regex (which can break depending on file encoding).
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
