"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useCurrentProjectId } from "@/hooks/useCurrentProjectId";
import { useUnifiedProjects } from "@/hooks/useUnifiedProjects";

// TopBar dropdown that scopes the calendar + dashboard to a single
// project (or "All projects"). Sits next to OrgSwitcher; same UX
// patterns (click-outside, persisted via localStorage, single-item orgs
// collapse to a static label).
export function ProjectSwitcher() {
  const { orgId } = useCurrentOrgId();
  const { projectId, setProjectId } = useCurrentProjectId();
  const projects = useUnifiedProjects(orgId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Split by source so we can show a small section header in the menu.
  const grouped = useMemo(() => {
    const list = projects.data ?? [];
    return {
      native: list.filter((p) => p.kind === "native"),
      upstream: list.filter((p) => p.kind === "upstream"),
    };
  }, [projects.data]);

  if (!orgId) return null;
  if (projects.isLoading) {
    return <div className="h-6 w-32 rounded bg-(--color-bg)" />;
  }

  const current = projects.data?.find((p) => p.id === projectId);
  const label = current?.name ?? "All projects";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm rounded-md border border-(--color-border) bg-(--color-bg) hover:bg-(--color-card) px-2 py-1 transition-colors max-w-[14rem]"
        title={label}
      >
        <span className="font-medium text-(--color-fg) truncate">{label}</span>
        {current?.kind === "upstream" && current.provider && (
          <span className="text-[10px] text-(--color-muted) uppercase shrink-0">{current.provider}</span>
        )}
        <span className="text-(--color-muted) text-xs shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-(--color-border) bg-(--color-card) shadow-lg z-20 py-1 max-h-96 overflow-y-auto">
          <button
            onClick={() => { setProjectId(null); setOpen(false); }}
            className={
              "w-full text-left px-3 py-1.5 text-sm transition-colors " +
              (!projectId
                ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                : "text-(--color-fg) hover:bg-(--color-bg)")
            }
          >
            All projects
          </button>

          {grouped.native.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-(--color-muted)">Native</div>
              {grouped.native.map((p) => (
                <ProjectRow key={p.id} p={p} active={p.id === projectId} onPick={() => { setProjectId(p.id); setOpen(false); }} />
              ))}
            </>
          )}

          {grouped.upstream.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-(--color-muted)">From integrations</div>
              {grouped.upstream.map((p) => (
                <ProjectRow key={p.id} p={p} active={p.id === projectId} onPick={() => { setProjectId(p.id); setOpen(false); }} />
              ))}
            </>
          )}

          <div className="border-t border-(--color-border) mt-1 pt-1">
            <Link href="/projects" onClick={() => setOpen(false)} className="block px-3 py-1.5 text-xs text-indigo-600 hover:bg-(--color-bg)">
              + New project
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  p,
  active,
  onPick,
}: {
  p: { id: string; name: string; kind: "native" | "upstream"; provider: string | null; connectionName: string | null };
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={
        "w-full text-left px-3 py-1.5 text-sm transition-colors " +
        (active
          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
          : "text-(--color-fg) hover:bg-(--color-bg)")
      }
    >
      <div className="truncate">{p.name}</div>
      {p.kind === "upstream" && (
        <div className="text-[11px] text-(--color-muted) truncate">
          {p.provider}{p.connectionName ? ` · ${p.connectionName}` : ""}
        </div>
      )}
    </button>
  );
}
