"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useMyOrgs } from "@/hooks/useOrgs";

// Sub-nav at the top of every Settings view. Without this, the user
// has no way to get from /settings/account to /settings/integrations
// without going via the dashboard quick-links.
//
// We don't read the active path from a router hook because the shell
// uses `window.location.pathname` (Next App-Router catch-all). Cheap
// effect to keep this in sync after a client-side nav.
//
// Tabs are role-gated client-side as a UX nicety — the backend is the
// real authority (writes require Admin+, reads are gated per-resource).
// Hiding the Org Policy tab for non-admins keeps developers from landing
// on a page they can't edit; the calendar still pulls policy via the
// read endpoint without going through this nav.

type Tab = { href: string; label: string; adminOnly?: boolean };

const TABS: Tab[] = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/org-policy", label: "Org policy", adminOnly: true },
  { href: "/settings/integrations", label: "Integrations" },
];

export function SettingsNav() {
  const [path, setPath] = useState("");
  const { orgId } = useCurrentOrgId();
  const orgs = useMyOrgs();
  useEffect(() => {
    setPath(window.location.pathname);
    // Re-read on history pop (back/forward).
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const role = orgs.data?.find((o) => o.id === orgId)?.role;
  const isAdminOrHigher = role === "owner" || role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdminOrHigher);

  return (
    <nav className="flex items-center gap-1 border-b border-(--color-border) -mx-6 px-6 pb-3 mb-2">
      {visibleTabs.map((t) => {
        const active = path === t.href || (t.href === "/settings/account" && path === "/settings");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "text-sm px-3 py-1.5 rounded-md transition-colors " +
              (active
                ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                : "text-(--color-muted) hover:text-(--color-fg) hover:bg-(--color-bg)")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
