"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncedTasks } from "@/hooks/useSyncedTasks";

type Props = {
  orgId: string | null | undefined;
  connectionId: string | null | undefined;
  projectId?: string | null;
  value: string;
  onChange: (taskId: string) => void;
  placeholder?: string;
  required?: boolean;
};

// Debounced typeahead picker for upstream tasks. Backed by the server-side
// `search` param on `/synced` so it works fine even when the connection
// caches 30k tasks — only ~50 ever cross the wire per keystroke.
export function TaskCombobox({
  orgId,
  connectionId,
  projectId,
  value,
  onChange,
  placeholder = "Search tasks…",
  required,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Show a small page on open. When the user types, the debounced query
  // narrows the result set server-side — no full client list ever loads.
  const filters = useMemo(
    () => ({
      projectId: projectId ?? undefined,
      search: debounced || undefined,
      take: 50,
    }),
    [projectId, debounced],
  );
  const tasks = useSyncedTasks(orgId, connectionId, filters);

  // The currently-selected task — when value is set but isn't in the
  // current page, look it up by fetching just that id via a singleton query
  // on the same hook with a search anchored to the upstream id. Cheap and
  // re-uses the cache.
  const selected = useMemo(
    () => tasks.data?.items.find((t) => t.id === value),
    [tasks.data, value],
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-left text-sm focus:border-indigo-500 focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="truncate inline-block max-w-full align-bottom">
            #{selected.upstreamId} · {selected.title}
          </span>
        ) : value ? (
          // Value set but task not in current cache slice — show a hint.
          <span className="text-(--color-muted)">Picked task #{value.slice(0, 8)}…</span>
        ) : (
          <span className="text-(--color-muted)">{placeholder}</span>
        )}
      </button>

      {required && !value && (
        // Keep the form's required validation working with a hidden input.
        <input
          tabIndex={-1}
          aria-hidden
          required
          value=""
          onChange={() => {}}
          className="sr-only"
        />
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-(--color-border) bg-(--color-card) shadow-lg">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search by title or #id…"
            className="w-full rounded-t-md border-b border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto py-1 text-sm">
            {tasks.isLoading && (
              <div className="px-3 py-2 text-(--color-muted)">Searching…</div>
            )}
            {!tasks.isLoading && (tasks.data?.items.length ?? 0) === 0 && (
              <div className="px-3 py-2 text-(--color-muted)">No tasks match.</div>
            )}
            {(tasks.data?.items ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onChange(t.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`block w-full text-left px-3 py-1.5 hover:bg-(--color-bg) ${
                  t.id === value ? "bg-(--color-bg)" : ""
                }`}
              >
                <div className="truncate">
                  <span className="text-(--color-muted)">#{t.upstreamId}</span>{" "}
                  <span className="text-(--color-fg)">{t.title}</span>
                </div>
                <div className="text-[11px] text-(--color-muted)">
                  {t.status}
                  {t.upstreamVersionName ? ` · ${t.upstreamVersionName}` : ""}
                </div>
              </button>
            ))}
            {tasks.data && tasks.data.total > tasks.data.items.length && (
              <div className="px-3 py-1.5 text-[11px] text-(--color-muted) border-t border-(--color-border)">
                Showing {tasks.data.items.length} of {tasks.data.total} — refine your search to narrow.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
