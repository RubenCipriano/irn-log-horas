"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useCreateProject, useDeleteProject, useUpdateProject } from "@/hooks/useProjects";
import { useSyncedTasks, useSyncedVersions } from "@/hooks/useSyncedTasks";
import { useCreateTask, useDeleteTask, useTasks } from "@/hooks/useTasks";
import { useUnifiedProjects } from "@/hooks/useUnifiedProjects";
import type { UnifiedProjectItem } from "@/lib/types";
import { ProjectMembersEditor } from "@/components/ProjectMembersEditor";

// Unified projects view — native PM projects + upstream sub-projects
// from every connected integration appear in one list. Clicking a row
// opens a side panel showing that project's tasks:
//   * native → useTasks (read/write)
//   * upstream → useSyncedTasks (read-only)
// Per user request, integration projects are treated as first-class
// projects — no badges, no labels distinguishing them from native at
// the top level. The side panel reveals the source.
export function ProjectsView() {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const [showArchived, setShowArchived] = useState(false);
  const list = useUnifiedProjects(orgId, showArchived);
  const create = useCreateProject(orgId);
  const update = useUpdateProject(orgId);
  const del = useDeleteProject(orgId);
  const [selected, setSelected] = useState<UnifiedProjectItem | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [newDefaultBillRate, setNewDefaultBillRate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || name.trim().length < 2) {
      setFormError(t("projects.new.nameError"));
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        code: code.trim() || undefined,
        defaultBillRate: newDefaultBillRate.trim() ? Number(newDefaultBillRate) : undefined,
      });
      setName("");
      setCode("");
      setNewDefaultBillRate("");
    } catch (err) {
      setFormError(axiosErr(err) ?? t("projects.new.failed"));
    }
  }

  async function onDeleteProject(projectId: string, projectName: string) {
    setFormError(null);
    try {
      const r = await del.mutateAsync(projectId);
      // Detached-worklogs disclosure happens inline via the toast/error
      // area when nonzero.
      if (r?.detachedWorklogs && r.detachedWorklogs > 0) {
        setFormError(t("projects.detachedWorklogs", { name: projectName, count: r.detachedWorklogs }));
      }
      if (selected?.nativeProjectId === projectId) setSelected(null);
    } catch (err) {
      setFormError(axiosErr(err) ?? t("projects.deleteFailed"));
    }
  }

  if (!orgId) {
    return <div className="p-6 text-sm text-(--color-muted)">{t("common.pickOrgFirst")}</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">{t("sidebar.projects")}</p>
        <h2 className="text-xl font-semibold text-(--color-fg) mt-1">{t("projects.title")}</h2>
        <p className="text-xs text-(--color-muted) mt-1">
          {t("projects.subtitle")}
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <section className="space-y-3 tf-fade-up">
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-2 text-xs text-(--color-muted)">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-indigo-600"
              />
              {t("projects.showArchived")}
            </label>
          </div>

          {list.isLoading && <p className="text-sm text-(--color-muted)">{t("common.loading")}</p>}
          {list.data && list.data.length === 0 && (
            <p className="text-sm text-(--color-muted)">{t("projects.empty")}</p>
          )}

          {list.data && list.data.length > 0 && (
            <ul className="space-y-2">
              {list.data.map((p) => {
                const isActive = selected?.id === p.id;
                return (
                  <li
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={
                      "rounded-xl border bg-(--color-card) p-4 cursor-pointer transition-colors " +
                      (isActive
                        ? "border-indigo-500 ring-2 ring-indigo-200"
                        : "border-(--color-border) hover:border-indigo-300")
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-(--color-fg) flex items-center gap-2">
                          {p.name}
                          {p.archived && (
                            <span className="text-[10px] uppercase tracking-wider bg-(--color-bg) text-(--color-muted) border border-(--color-border) rounded px-1.5 py-0.5">
                              {t("project.archivedBadge")}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-(--color-muted) mt-0.5 truncate">
                          {p.code && <span className="font-mono">{p.code}</span>}
                          {p.kind === "upstream" && p.provider && (
                            <span> · {p.provider}{p.connectionName ? ` · ${p.connectionName}` : ""}</span>
                          )}
                        </p>
                      </div>
                      {p.kind === "native" && p.nativeProjectId && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Link
                            href={`/projects/${p.nativeProjectId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded border border-(--color-border) hover:border-indigo-300 transition-colors"
                            title={t("projects.open")}
                          >
                            {t("projects.open")}
                          </Link>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              update.mutate({ projectId: p.nativeProjectId!, patch: { archived: !p.archived } });
                            }}
                            disabled={update.isPending}
                            className="text-xs text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded border border-(--color-border) hover:border-indigo-300 transition-colors disabled:opacity-50"
                          >
                            {p.archived ? t("common.restore") : t("common.archive")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(t("projects.deleteConfirm", { name: p.name }))) {
                                onDeleteProject(p.nativeProjectId!, p.name);
                              }
                            }}
                            disabled={del.isPending}
                            className="text-xs text-rose-500 hover:text-rose-700 px-2 py-1 disabled:opacity-50"
                            title={t("common.delete")}
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 h-fit space-y-3 tf-fade-up">
            <h3 className="text-sm font-semibold text-(--color-fg)">{t("projects.new")}</h3>
            <p className="text-xs text-(--color-muted)">
              {t("projects.new.hint")}
            </p>
            <form onSubmit={onCreate} className="space-y-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">{t("projects.new.name")}</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={create.isPending}
                  className={inputCls()}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">{t("projects.new.code")}</span>
                <input
                  type="text"
                  maxLength={40}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={create.isPending}
                  placeholder={t("projects.new.codePlaceholder")}
                  className={inputCls()}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">{t("projects.new.defaultBillRate")}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newDefaultBillRate}
                  onChange={(e) => setNewDefaultBillRate(e.target.value)}
                  disabled={create.isPending}
                  placeholder={t("projects.new.defaultBillRatePlaceholder")}
                  className={inputCls()}
                />
              </label>
              {formError && (
                <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">{formError}</p>
              )}
              <button type="submit" disabled={create.isPending} className={btnPrimary()}>
                {create.isPending ? t("projects.new.submitting") : t("projects.new.submit")}
              </button>
            </form>
          </div>

          {selected && (
            <div className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 tf-fade-up">
              <TasksPanel project={selected} orgId={orgId} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TasksPanel({ project, orgId }: { project: UnifiedProjectItem; orgId: string }) {
  if (project.kind === "native" && project.nativeProjectId) {
    return (
      <div className="space-y-6">
        <NativeTasksPanel orgId={orgId} projectId={project.nativeProjectId} name={project.name} />
        <div className="pt-3 border-t border-(--color-border)">
          <ProjectMembersEditor orgId={orgId} projectId={project.nativeProjectId} mode="panel" />
        </div>
      </div>
    );
  }
  if (project.kind === "upstream" && project.connectionId && project.upstreamProjectId) {
    return (
      <UpstreamTasksPanel
        orgId={orgId}
        connectionId={project.connectionId}
        upstreamProjectId={project.upstreamProjectId}
        name={project.name}
      />
    );
  }
  return null;
}

function NativeTasksPanel({ orgId, projectId, name }: { orgId: string; projectId: string; name: string }) {
  const { t } = useTranslation();
  const list = useTasks(orgId, projectId);
  const create = useCreateTask(orgId, projectId);
  const del = useDeleteTask(orgId, projectId);
  const [title, setTitle] = useState("");

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await create.mutateAsync({ title: title.trim() });
      setTitle("");
    } catch { /* error surfaced via mutation */ }
  }

  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg) truncate">{name}</h3>
        <p className="text-xs text-(--color-muted)">{t("projects.panel.tasksCount", { count: list.data?.length ?? 0 })}</p>
      </header>

      {list.isLoading && <p className="text-xs text-(--color-muted)">{t("common.loading")}</p>}
      {list.data && list.data.length > 0 && (
        <ul className="max-h-72 overflow-y-auto space-y-1 rounded-md border border-(--color-border)">
          {list.data.map((task) => (
            <li key={task.id} className="px-3 py-2 text-xs flex items-start gap-2 hover:bg-(--color-bg)">
              <div className="flex-1 min-w-0">
                <div className="text-(--color-fg) truncate">{task.title}</div>
                <div className="text-(--color-muted)">{task.status}</div>
              </div>
              <button
                onClick={() => { if (confirm(t("projects.panel.deleteTaskConfirm", { title: task.title }))) del.mutate(task.id); }}
                disabled={del.isPending}
                className="text-rose-500 hover:text-rose-700 disabled:opacity-50"
                title={t("common.delete")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onCreate} className="flex items-center gap-2">
        <input
          type="text"
          required
          minLength={2}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("projects.panel.newTaskPlaceholder")}
          disabled={create.isPending}
          className="flex-1 rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none disabled:opacity-50"
        />
        <button type="submit" disabled={create.isPending} className="text-xs rounded-md bg-indigo-600 text-white px-2 py-1.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {t("common.add")}
        </button>
      </form>
    </div>
  );
}

function UpstreamTasksPanel({
  orgId, connectionId, upstreamProjectId, name,
}: {
  orgId: string;
  connectionId: string;
  upstreamProjectId: string;
  name: string;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [versionId, setVersionId] = useState("");
  const [page, setPage] = useState(0);
  const take = 50;

  // Reset to page 0 when any filter changes — otherwise we'd silently
  // skip past data on a tighter filter and look "empty."
  useEffect(() => { setPage(0); }, [debounced, status, versionId]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const tasks = useSyncedTasks(orgId, connectionId, {
    projectId: upstreamProjectId,
    search: debounced || undefined,
    status: status || undefined,
    versionId: versionId || undefined,
    skip: page * take,
    take,
  });
  const versions = useSyncedVersions(orgId, connectionId);

  // Status options come from the current page — good enough since
  // OpenProject status sets are small (≤15) and the most-recent page
  // surfaces them all in practice. If the matrix ever needs a server
  // listing endpoint we add `/synced/statuses` mirroring `/synced/versions`.
  const statusOptions = Array.from(
    new Set((tasks.data?.items ?? []).map((t) => t.status)),
  ).sort();

  const total = tasks.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg) truncate">{name}</h3>
        <p className="text-xs text-(--color-muted)">
          {total} synced tasks · read-only (edit upstream)
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / #id…"
          className="col-span-3 rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All sprints</option>
          <option value="none">(no sprint)</option>
          {(versions.data ?? []).map((v) => (
            <option key={v.upstreamVersionId} value={v.upstreamVersionId}>
              {v.upstreamVersionName} · {v.taskCount}
            </option>
          ))}
        </select>
      </div>

      {tasks.isLoading && <p className="text-xs text-(--color-muted)">Loading…</p>}
      {tasks.data && tasks.data.items.length === 0 && (
        <p className="text-xs text-(--color-muted)">No tasks match.</p>
      )}
      {tasks.data && tasks.data.items.length > 0 && (
        <ul className="max-h-96 overflow-y-auto rounded-md border border-(--color-border) divide-y divide-(--color-border)">
          {tasks.data.items.map((t) => (
            <li key={t.id} className="px-3 py-2 text-xs flex items-start gap-2 hover:bg-(--color-bg)">
              <span className="font-mono text-(--color-muted) shrink-0">#{t.upstreamId}</span>
              <div className="flex-1 min-w-0">
                <div className="text-(--color-fg) truncate">{t.title}</div>
                <div className="text-(--color-muted)">
                  {t.status}
                  {t.upstreamVersionName ? ` · ${t.upstreamVersionName}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > take && (
        <div className="flex items-center justify-between text-xs text-(--color-muted)">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>Page {page + 1} of {pages}</span>
          <button
            type="button"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function inputCls() {
  return "w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}
function btnPrimary() {
  return "w-full rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors";
}

function axiosErr(err: unknown): string | null {
  if (axios.isAxiosError(err) && err.response?.data?.error) return String(err.response.data.error);
  return null;
}

