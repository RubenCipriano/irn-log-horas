"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import type { UnifiedTaskItem, UpdateTaskBody } from "@/hooks/useAllTasks";
import { useUpdateAnyTask, useCreateAnyTask } from "@/hooks/useAllTasks";

type Props = {
  orgId: string;
  // When `mode === "edit"`, we patch the existing row's fields. When
  // `mode === "create-native"` or `create-upstream"`, we open a blank
  // form scoped to the selected project / connection.
  mode: "edit" | "create-native" | "create-upstream";
  initial?: UnifiedTaskItem;
  createScope?: {
    nativeProjectId?: string;
    connectionId?: string;
    upstreamProjectId?: string;
  };
  onClose: () => void;
};

export function TaskEditDrawer({ orgId, mode, initial, createScope, onClose }: Props) {
  const update = useUpdateAnyTask(orgId);
  const create = useCreateAnyTask(orgId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState(initial?.status ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [assignee, setAssignee] = useState(initial?.assigneeUpstreamId ?? "");
  const [versionId, setVersionId] = useState(initial?.upstreamVersionId ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initial?.title ?? "");
    setStatus(initial?.status ?? "");
    setDescription(initial?.description ?? "");
    setAssignee(initial?.assigneeUpstreamId ?? "");
    setVersionId(initial?.upstreamVersionId ?? "");
    setError(null);
  }, [initial?.id, initial?.title, initial?.status, initial?.description, initial?.assigneeUpstreamId, initial?.upstreamVersionId]);

  const isUpstream = mode === "create-upstream" || initial?.kind === "upstream";
  const heading = mode === "edit" ? "Edit task" : mode === "create-native" ? "New native task" : "New upstream task";

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "edit") {
        const body: UpdateTaskBody = {
          title: title || undefined,
          status: status || undefined,
          description: description || undefined,
        };
        if (isUpstream) {
          body.assigneeUpstreamId = assignee || undefined;
          body.upstreamVersionId = versionId || undefined;
        }
        await update.mutateAsync({ taskId: initial!.id, body });
      } else if (mode === "create-native") {
        if (!createScope?.nativeProjectId) {
          setError("Pick a project before creating.");
          return;
        }
        await create.mutateAsync({
          kind: "native",
          nativeProjectId: createScope.nativeProjectId,
          title,
          description: description || undefined,
          status: status || undefined,
        });
      } else {
        if (!createScope?.connectionId || !createScope?.upstreamProjectId) {
          setError("Pick a connection + upstream project before creating.");
          return;
        }
        await create.mutateAsync({
          kind: "upstream",
          connectionId: createScope.connectionId,
          upstreamProjectId: createScope.upstreamProjectId,
          title,
          description: description || undefined,
          status: status || undefined,
          assigneeUpstreamId: assignee || undefined,
          upstreamVersionId: versionId || undefined,
        });
      }
      onClose();
    } catch (err) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : "Save failed.";
      setError(msg);
    }
  }

  const pending = update.isPending || create.isPending;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="w-[420px] max-w-full bg-(--color-card) border-l border-(--color-border) p-5 overflow-y-auto">
        <header className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-(--color-fg)">{heading}</h3>
          <button onClick={onClose} className="text-(--color-muted) hover:text-(--color-fg) text-lg">×</button>
        </header>

        <form onSubmit={onSave} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              className={inputCls()}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Status</span>
            <input
              type="text"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder={isUpstream ? "Status name (e.g. 'In progress')" : "open / in-progress / done"}
              disabled={pending}
              className={inputCls()}
            />
            {isUpstream && (
              <span className="text-[11px] text-(--color-muted)">
                OpenProject expects a status id; the API translates "Status name" → id at runtime if your provider supports it.
              </span>
            )}
          </label>
          {isUpstream && (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">Assignee (upstream id)</span>
                <input
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Numeric user id"
                  disabled={pending}
                  className={inputCls()}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">Sprint / version id</span>
                <input
                  type="text"
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  placeholder="Version id"
                  disabled={pending}
                  className={inputCls()}
                />
              </label>
            </>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={pending}
              className={inputCls()}
            />
          </label>

          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-xs text-(--color-muted) hover:text-(--color-fg) px-3 py-1.5">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !title.trim()}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {pending ? "Saving…" : mode === "edit" ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function inputCls() {
  return "w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}
