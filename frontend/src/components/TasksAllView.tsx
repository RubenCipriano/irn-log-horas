"use client";

import { useEffect, useState } from "react";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useAllTasks, useDeleteAnyTask, type UnifiedTaskItem } from "@/hooks/useAllTasks";
import { useUnifiedProjects } from "@/hooks/useUnifiedProjects";
import { useSyncedVersions } from "@/hooks/useSyncedTasks";
import { TaskEditDrawer } from "@/components/TaskEditDrawer";

// Manager+ org-wide tasks browse. Same filter row as MyTasksView (search,
// status, sprint, connection) plus the native/upstream split — clicking a
// row opens the edit drawer; the "New task" button at top-right opens a
// blank create form scoped to whatever filter is set.
//
// The page assumes the backend has gated `GET /tasks` to Manager+. The
// Sidebar link is hidden too as a UX nicety, but direct URL access lands
// on a 403 from the backend regardless.
export function TasksAllView() {
  const { orgId } = useCurrentOrgId();
  const connections = useIntegrations(orgId);
  const projects = useUnifiedProjects(orgId, false);
  const remove = useDeleteAnyTask(orgId);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [versionId, setVersionId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [page, setPage] = useState(0);
  const take = 50;

  const [drawer, setDrawer] = useState<
    | { mode: "edit"; row: UnifiedTaskItem }
    | { mode: "create-native" }
    | { mode: "create-upstream" }
    | null
  >(null);
  const [createNativeProjectId, setCreateNativeProjectId] = useState("");
  const [createConnectionId, setCreateConnectionId] = useState("");
  const [createUpstreamProjectId, setCreateUpstreamProjectId] = useState("");

  useEffect(() => { setPage(0); }, [debounced, status, versionId, connectionId]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const tasks = useAllTasks(orgId, {
    search: debounced || undefined,
    status: status || undefined,
    versionId: versionId || undefined,
    connectionId: connectionId || undefined,
    skip: page * take,
    take,
  });
  const versions = useSyncedVersions(orgId, connectionId || null);

  const statusOptions = Array.from(
    new Set((tasks.data?.items ?? []).map((t) => t.status)),
  ).sort();

  const total = tasks.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / take));

  const nativeProjects = (projects.data ?? []).filter((p) => p.kind === "native");
  const upstreamProjectsByConn = (projects.data ?? []).filter((p) => p.kind === "upstream");

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">Pick an org first.</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-fg)">All tasks</h1>
          <p className="text-sm text-(--color-muted)">
            Org-wide browse across native and upstream projects. Edits to upstream rows push back to the tracker.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDrawer({ mode: "create-native" })}
            className="rounded-md border border-(--color-border) text-(--color-fg) px-3 py-1.5 text-sm hover:bg-(--color-bg)"
          >
            New native task
          </button>
          <button
            type="button"
            onClick={() => setDrawer({ mode: "create-upstream" })}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700"
          >
            New upstream task
          </button>
        </div>
      </header>

      <div className="rounded-lg border border-(--color-border) bg-(--color-card) p-4 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / #id…"
            className="col-span-4 rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All connections</option>
            {(connections.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            disabled={!connectionId}
            className="col-span-2 rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
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

        {tasks.isLoading && <p className="text-sm text-(--color-muted)">Loading…</p>}
        {tasks.data && tasks.data.items.length === 0 && (
          <p className="text-sm text-(--color-muted)">No tasks match.</p>
        )}
        {tasks.data && tasks.data.items.length > 0 && (
          <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
            {tasks.data.items.map((t) => (
              <li key={t.id} className="px-3 py-2 text-sm flex items-start gap-3 hover:bg-(--color-bg)">
                <span
                  className={
                    "shrink-0 mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
                    (t.kind === "upstream"
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300")
                  }
                >
                  {t.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-(--color-fg) truncate">{t.title}</div>
                  <div className="text-xs text-(--color-muted)">
                    {t.upstreamId ? `#${t.upstreamId} · ` : ""}{t.status}
                    {t.upstreamVersionName ? ` · ${t.upstreamVersionName}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawer({ mode: "edit", row: t })}
                  className="text-xs text-indigo-600 hover:underline px-2"
                >
                  Edit
                </button>
                {t.kind === "native" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete "${t.title}"?`)) remove.mutate(t.id);
                    }}
                    disabled={remove.isPending}
                    className="text-xs text-rose-500 hover:text-rose-700 disabled:opacity-50 px-2"
                  >
                    Delete
                  </button>
                )}
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
            <span>Page {page + 1} of {pages} — {total} tasks</span>
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

      {drawer?.mode === "edit" && (
        <TaskEditDrawer
          orgId={orgId}
          mode="edit"
          initial={drawer.row}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer?.mode === "create-native" && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/30" onClick={() => setDrawer(null)} aria-hidden />
          <aside className="w-[420px] max-w-full bg-(--color-card) border-l border-(--color-border) p-5 space-y-3">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-(--color-fg)">Pick a native project</h3>
              <button onClick={() => setDrawer(null)} className="text-(--color-muted) hover:text-(--color-fg) text-lg">×</button>
            </header>
            <select
              value={createNativeProjectId}
              onChange={(e) => setCreateNativeProjectId(e.target.value)}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm"
            >
              <option value="">— pick —</option>
              {nativeProjects.map((p) => (
                <option key={p.id} value={p.nativeProjectId ?? ""}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!createNativeProjectId}
              onClick={() => setDrawer({ mode: "create-native" })}
              className="hidden"
            />
            {createNativeProjectId && (
              <TaskEditDrawer
                orgId={orgId}
                mode="create-native"
                createScope={{ nativeProjectId: createNativeProjectId }}
                onClose={() => { setDrawer(null); setCreateNativeProjectId(""); }}
              />
            )}
          </aside>
        </div>
      )}
      {drawer?.mode === "create-upstream" && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/30" onClick={() => setDrawer(null)} aria-hidden />
          <aside className="w-[420px] max-w-full bg-(--color-card) border-l border-(--color-border) p-5 space-y-3">
            <header className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-(--color-fg)">Pick a connection + project</h3>
              <button onClick={() => setDrawer(null)} className="text-(--color-muted) hover:text-(--color-fg) text-lg">×</button>
            </header>
            <select
              value={createConnectionId}
              onChange={(e) => { setCreateConnectionId(e.target.value); setCreateUpstreamProjectId(""); }}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm"
            >
              <option value="">— connection —</option>
              {(connections.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={createUpstreamProjectId}
              onChange={(e) => setCreateUpstreamProjectId(e.target.value)}
              disabled={!createConnectionId}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">— upstream project —</option>
              {upstreamProjectsByConn
                .filter((p) => p.connectionId === createConnectionId)
                .map((p) => (
                  <option key={p.id} value={p.upstreamProjectId ?? ""}>{p.name}</option>
                ))}
            </select>
            {createConnectionId && createUpstreamProjectId && (
              <TaskEditDrawer
                orgId={orgId}
                mode="create-upstream"
                createScope={{ connectionId: createConnectionId, upstreamProjectId: createUpstreamProjectId }}
                onClose={() => { setDrawer(null); setCreateConnectionId(""); setCreateUpstreamProjectId(""); }}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
