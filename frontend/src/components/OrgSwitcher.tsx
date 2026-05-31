"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useMyOrgs } from "@/hooks/useOrgs";

// Inline dropdown that lets a user in multiple orgs switch which one
// the views read from. Single-org users see the org name as a static
// label (no menu) — switcher would just be noise.
export function OrgSwitcher() {
  const orgs = useMyOrgs();
  const { orgId, setOrgId } = useCurrentOrgId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (orgs.isLoading) return <div className="h-6 w-32 rounded bg-(--color-bg)" />;
  if (!orgs.data || orgs.data.length === 0) {
    return (
      <Link href="/onboarding/create-org" className="text-xs text-indigo-600 hover:underline">
        + Create org
      </Link>
    );
  }

  const current = orgs.data.find((o) => o.id === orgId) ?? orgs.data[0];

  if (orgs.data.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-(--color-fg)">{current.name}</span>
        <span className="text-xs text-(--color-muted)">· {current.role}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm rounded-md border border-(--color-border) bg-(--color-bg) hover:bg-(--color-card) px-2 py-1 transition-colors"
      >
        <span className="font-medium text-(--color-fg)">{current.name}</span>
        <span className="text-xs text-(--color-muted)">{current.role}</span>
        <span className="text-(--color-muted) text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 rounded-lg border border-(--color-border) bg-(--color-card) shadow-lg z-20 py-1">
          {orgs.data.map((o) => (
            <button
              key={o.id}
              onClick={() => { setOrgId(o.id); setOpen(false); }}
              className={
                "w-full text-left px-3 py-1.5 text-sm transition-colors " +
                (o.id === orgId
                  ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "text-(--color-fg) hover:bg-(--color-bg)")
              }
            >
              <div>{o.name}</div>
              <div className="text-xs text-(--color-muted)">{o.role}</div>
            </button>
          ))}
          <div className="border-t border-(--color-border) mt-1 pt-1">
            <Link
              href="/onboarding/create-org"
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-xs text-indigo-600 hover:bg-(--color-bg)"
            >
              + Create another org
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
