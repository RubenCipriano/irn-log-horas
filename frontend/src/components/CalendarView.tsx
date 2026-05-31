"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useCurrentProjectId } from "@/hooks/useCurrentProjectId";
import { useProjects } from "@/hooks/useProjects";
import { useSyncedTasks } from "@/hooks/useSyncedTasks";
import { useTasks } from "@/hooks/useTasks";
import { useUnifiedProjects } from "@/hooks/useUnifiedProjects";
import { TaskCombobox } from "@/components/TaskCombobox";
import { CalendarMonthGrid } from "@/components/CalendarMonthGrid";
import {
  groupByDate,
  indexByDate,
  monthDateRange,
  startOfMonth,
} from "@/lib/calendar-grid";
import {
  useCreateWorklog,
  useDeleteWorklog,
  useExpectedHours,
  useHolidays,
  useWorklogs,
} from "@/hooks/useWorklogs";
import type { HolidayItem, UnifiedProjectItem, WorklogItem } from "@/lib/types";

// Monthly calendar grid. Each day cell shows:
//   * the date number
//   * a "Xh / Yh" total (logged / expected)
//   * a holiday badge when applicable
// Clicking a day opens an entry sheet on the right: list existing
// entries + add a new one against a chosen project.
export function CalendarView() {
  const { orgId } = useCurrentOrgId();
  const { projectId: activeProjectId } = useCurrentProjectId();

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string | null>(null);

  const range = useMemo(() => monthDateRange(cursor), [cursor]);
  const projects = useUnifiedProjects(orgId);

  // When the topbar ProjectSwitcher has a project selected, the grid
  // only counts that project's hours. After the hierarchical-projects
  // refactor the switcher's options are root engagements, but worklogs
  // sit on leaf sub-projects (engagement → wrapper → upstream subs →
  // tasks). The /worklogs endpoint walks the subtree when projectId is
  // supplied, so a single server-side filter is enough.
  const activeProject = activeProjectId
    ? (projects.data ?? []).find((p) => p.id === activeProjectId) ?? null
    : null;
  const nativeProjectFilter =
    activeProject?.kind === "native" ? activeProject.nativeProjectId : null;

  // The expected-hours denominator + holiday badges follow the project's
  // effective policy when a native engagement is active in the topbar
  // switcher. "All projects" or an upstream-only project (which has no
  // native row to hang policy on) falls back to org-level resolution.
  const expected = useExpectedHours(orgId, range.from, range.to, nativeProjectFilter);
  const logs = useWorklogs(orgId, range.from, range.to, nativeProjectFilter);
  const holidays = useHolidays(orgId, cursor.getFullYear(), nativeProjectFilter);

  const filteredLogs = useMemo(() => {
    const all = logs.data ?? [];
    // Upstream-kind unified projects (legacy, kept for adapters that
    // surface non-mirrored tasks) still need a client-side narrowing
    // by upstream connection id. Native subtree filtering already
    // happened server-side via the projectId query param.
    if (activeProject?.kind === "upstream") {
      return all.filter((l) => l.upstreamProjectId === activeProject.upstreamProjectId);
    }
    return all;
  }, [logs.data, activeProject]);

  const logsByDay = useMemo(() => groupByDate(filteredLogs), [filteredLogs]);
  const expectedByDay = useMemo(() => indexByDate(expected.data?.days ?? []), [expected.data]);
  const holidaysByDay = useMemo(() => indexByDate(holidays.data?.holidays ?? []), [holidays.data]);

  if (!orgId) {
    return (
      <div className="p-6">
        <NoOrgCta />
      </div>
    );
  }

  const selectedLogs = selected ? logsByDay.get(selected) ?? [] : [];

  return (
    <div className="p-6 grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="tf-fade-up">
        <CalendarMonthGrid
          cursor={cursor}
          onCursorChange={setCursor}
          logsByDay={logsByDay}
          expectedByDay={expectedByDay}
          holidaysByDay={holidaysByDay}
          selectedIso={selected}
          onSelect={setSelected}
          monthLabelLocale="en-US"
        />
      </div>

      <aside className="rounded-2xl border border-(--color-border) bg-(--color-card) p-4 h-fit lg:sticky lg:top-20">
        {!selected ? (
          <p className="text-sm text-(--color-muted) text-center py-8">
            Click a day to log hours.
          </p>
        ) : (
          <DayEntries
            orgId={orgId}
            date={selected}
            entries={selectedLogs}
            projects={projects.data ?? []}
            defaultProjectId={activeProjectId}
            holiday={holidaysByDay.get(selected)}
          />
        )}
      </aside>
    </div>
  );
}

function DayEntries({
  orgId,
  date,
  entries,
  projects,
  defaultProjectId,
  holiday,
}: {
  orgId: string;
  date: string;
  entries: WorklogItem[];
  projects: UnifiedProjectItem[];
  defaultProjectId: string | null;
  holiday?: HolidayItem;
}) {
  const { t } = useTranslation();
  const create = useCreateWorklog(orgId);
  const del = useDeleteWorklog(orgId);
  // Native project list (to check whether the project carries any rate)
  // — drives the "Billable" default. Cheap query, already cached.
  const nativeProjects = useProjects(orgId, false);
  // `projectId` here is the unified id (native:guid or upstream:connId:upstreamId).
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [taskId, setTaskId] = useState<string>("");
  const [hours, setHours] = useState("1");
  const [notes, setNotes] = useState("");
  const [isBillable, setIsBillable] = useState(false);

  // Default to the topbar's active project, else first project in the list.
  if (projectId === "" && projects.length > 0) {
    setProjectId(defaultProjectId ?? projects[0].id);
  }

  const activeProject = projects.find((p) => p.id === projectId) ?? null;
  const isNative = activeProject?.kind === "native";
  const isUpstream = activeProject?.kind === "upstream";

  // Default "Billable" from whether the project has ANY rate set
  // (default_bill_rate or bill_rate). Upstream sub-projects don't surface
  // their parent's rate in this list, so default to false there and let
  // the user check.
  const projectHasRate = isNative && activeProject?.nativeProjectId
    ? (() => {
        const p = (nativeProjects.data ?? []).find((x) => x.id === activeProject.nativeProjectId);
        return p ? (p.defaultBillRate !== null || p.billRate !== null) : false;
      })()
    : false;
  useEffect(() => {
    setIsBillable(projectHasRate);
  }, [projectHasRate]);

  // Native tasks if native project selected.
  const nativeTasks = useTasks(
    orgId,
    isNative ? activeProject!.nativeProjectId : null,
  );
  // Upstream tasks if upstream project selected (cap at 500 — top of list
  // is most-recently-updated, good enough for picker UX).
  const upstreamTasks = useSyncedTasks(
    orgId,
    isUpstream ? activeProject!.connectionId : null,
    isUpstream ? { projectId: activeProject!.upstreamProjectId ?? undefined, take: 500 } : {},
  );

  const total = entries.reduce((a, e) => a + e.hours, 0);

  // Display lookups. Native project names indexed by native_project_id.
  // Upstream project name indexed by upstream_task_id (resolved via the
  // synced task list — only available when an upstream project is active).
  const nativeProjectsById = new Map(
    projects.filter((p) => p.kind === "native").map((p) => [p.nativeProjectId, p.name]),
  );
  const nativeTasksById = new Map((nativeTasks.data ?? []).map((t) => [t.id, t.title]));
  const upstreamTasksById = new Map(
    (upstreamTasks.data?.items ?? []).map((t) => [t.id, { title: t.title, upstreamId: t.upstreamId }]),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProject) return;
    const h = parseFloat(hours);
    if (!Number.isFinite(h) || h <= 0) return;
    try {
      if (activeProject.kind === "native") {
        await create.mutateAsync({
          projectId: activeProject.nativeProjectId!,
          taskId: taskId || undefined,
          workDate: date,
          hours: h,
          notes: notes.trim() || undefined,
          isBillable,
        });
      } else {
        // Upstream worklogs MUST carry an upstreamTaskId — that's what
        // the backend uses to wire the push job and find the upstream
        // tracker. Block the submit if no task picked.
        if (!taskId) return;
        await create.mutateAsync({
          upstreamTaskId: taskId,
          workDate: date,
          hours: h,
          notes: notes.trim() || undefined,
          isBillable,
        });
      }
      setNotes("");
    } catch {
      /* errors surfaced via mutation.error if needed */
    }
  }

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">{date}</p>
        <p className="text-sm text-(--color-muted)">{total.toFixed(1)}h logged</p>
        {holiday && (
          <p className="text-xs text-rose-600 dark:text-rose-400">Holiday: {holiday.name}</p>
        )}
      </header>

      {entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e) => {
            const projName = e.projectId ? nativeProjectsById.get(e.projectId) : null;
            const upstreamTask = e.upstreamTaskId ? upstreamTasksById.get(e.upstreamTaskId) : null;
            const taskName = e.taskId
              ? nativeTasksById.get(e.taskId)
              : upstreamTask
                ? `${upstreamTask.title} (#${upstreamTask.upstreamId})`
                : null;
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-(--color-fg) shrink-0 tabular-nums">{e.hours.toFixed(1)}h</span>
                <div className="flex-1 min-w-0">
                  <div className="text-(--color-fg) truncate">
                    {projName ?? (e.upstreamTaskId ? "Upstream task" : "—")}
                    {taskName && <span className="text-(--color-muted)"> · {taskName}</span>}
                  </div>
                  {e.notes && <div className="text-(--color-muted) truncate">{e.notes}</div>}
                  <PushStatusBadge status={e.pushStatus} errorCode={e.pushErrorCode} />
                </div>
                <button
                  onClick={() => del.mutate(e.id)}
                  disabled={del.isPending}
                  className="text-rose-500 hover:text-rose-700 disabled:opacity-50"
                  title="Delete"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {projects.length === 0 ? (
        <p className="text-xs text-(--color-muted)">
          {t("calendar.dayForm.noProjects")}{" "}
          <Link href="/projects" className="text-indigo-600 hover:underline">{t("calendar.dayForm.goToProjects")}</Link>
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2 pt-2 border-t border-(--color-border)">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("calendar.dayForm.project")}</span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setTaskId(""); // reset task picker — different project's tasks aren't relevant
              }}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.kind === "upstream" && p.provider ? ` (${p.provider})` : ""}
                </option>
              ))}
            </select>
          </label>

          {isNative && (nativeTasks.data ?? []).length > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-(--color-fg)">{t("calendar.dayForm.taskOptional")}</span>
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="">{t("calendar.dayForm.noTask")}</option>
                {nativeTasks.data!.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} {task.status !== "open" ? `(${task.status})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isUpstream && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-(--color-fg)">{t("calendar.dayForm.taskRequired")}</span>
              <TaskCombobox
                orgId={orgId}
                connectionId={activeProject?.connectionId ?? null}
                projectId={activeProject?.upstreamProjectId ?? null}
                value={taskId}
                onChange={setTaskId}
                required
                placeholder={t("calendar.dayForm.searchTask")}
              />
              <p className="text-[11px] text-(--color-muted)">
                {t("calendar.dayForm.syncHint", { provider: activeProject?.provider ?? "" })}
              </p>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("calendar.dayForm.hours")}</span>
            <input
              type="number"
              step="0.25"
              min="0"
              max="24"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
              className="accent-indigo-600"
            />
            <span className="text-(--color-fg)">{t("calendar.dayForm.billable")}</span>
            {isNative && !projectHasRate && (
              <span className="text-(--color-muted)">
                {t("calendar.dayForm.noRateHint")}
              </span>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("calendar.dayForm.notes")}</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("calendar.dayForm.notesPlaceholder")}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {create.isPending ? t("calendar.dayForm.logging") : t("calendar.dayForm.addHours")}
          </button>
          {create.error && (
            <p className="text-xs text-rose-600">{t("calendar.dayForm.logFailed")}</p>
          )}
        </form>
      )}
    </div>
  );
}

function PushStatusBadge({ status, errorCode }: { status: string; errorCode: string | null }) {
  if (status === "none") return null;
  if (status === "pending") {
    return <div className="text-[11px] text-amber-600 dark:text-amber-400">⌛ Syncing to upstream…</div>;
  }
  if (status === "pushed") {
    return <div className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ Synced upstream</div>;
  }
  if (status === "failed") {
    return (
      <div className="text-[11px] text-rose-600 dark:text-rose-400">
        ⚠ Push failed{errorCode ? ` (${errorCode})` : ""}
      </div>
    );
  }
  return null;
}

function NoOrgCta() {
  return (
    <div className="max-w-md mx-auto text-center space-y-3 py-12 tf-fade-up">
      <p className="text-2xl font-bold text-(--color-fg)">No org yet</p>
      <p className="text-sm text-(--color-muted)">Create one to start logging hours.</p>
      <Link href="/onboarding/create-org" className="inline-block rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700">
        Create org →
      </Link>
    </div>
  );
}

