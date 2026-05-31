"use client";

import { useEffect, useState } from "react";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useMyTasks } from "@/hooks/useMyTasks";
import { useSyncedVersions } from "@/hooks/useSyncedTasks";

// Cross-connection task browse, filtered to "assigned to me." Spans every
// integration connection the caller can see (per-user ownership on the
// backend means non-admins only see their own connections; admins see all).
// Filters mirror the panel on /projects so muscle memory carries over.
export function MyTasksView() {
  const { orgId } = useCurrentOrgId();
  const connections = useIntegrations(orgId);
  const [connectionId, setConnectionId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [versionId, setVersionId] = useState("");
  const [page, setPage] = useState(0);
  const take = 50;

  useEffect(() => { setPage(0); }, [debounced, status, versionId, connectionId]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const tasks = useMyTasks(orgId, {
    connectionId: connectionId || undefined,
    search: debounced || undefined,
    status: status || undefined,
    versionId: versionId || undefined,
    skip: page * take,
    take,
  });

  // Sprint dropdown is per-connection. When no connection is picked we
  // fall back to "no sprints available" since the versions cache is keyed
  // per connection — listing across all connections would require a
  // separate endpoint, and the typical use is "I picked my connection".
  const versions = useSyncedVersions(orgId, connectionId || null);

  const statusOptions = Array.from(
    new Set((tasks.data?.items ?? []).map((t) => t.status)),
  ).sort();

  const total = tasks.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-(--color-fg)">My tasks</h1>
        <p className="text-sm text-(--color-muted)">
          Synced from your integration connections. Read-only — edit upstream to update.
        </p>
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
                <span className="font-mono text-xs text-(--color-muted) shrink-0 mt-0.5">#{t.upstreamId}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-(--color-fg) truncate">{t.title}</div>
                  <div className="text-xs text-(--color-muted)">
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
    </div>
  );
}
