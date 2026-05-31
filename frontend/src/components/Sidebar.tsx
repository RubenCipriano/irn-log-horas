"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { AuthUser } from "@/hooks/useAuth";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useLogout } from "@/hooks/useLogout";
import { useMyOrgs } from "@/hooks/useOrgs";

type NavItem = {
  href: string;
  labelKey: string;
  icon: string;
  managerPlus?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "sidebar.dashboard", icon: "▦" },
  { href: "/calendar", labelKey: "sidebar.calendar", icon: "▤" },
  { href: "/projects", labelKey: "sidebar.projects", icon: "▣" },
  { href: "/members", labelKey: "sidebar.members", icon: "◉" },
  { href: "/tasks", labelKey: "sidebar.allTasks", icon: "≡", managerPlus: true },
  { href: "/tasks/me", labelKey: "sidebar.myTasks", icon: "✓" },
  { href: "/invoices", labelKey: "sidebar.invoices", icon: "$", managerPlus: true },
  { href: "/reports", labelKey: "sidebar.reports", icon: "▥" },
  { href: "/settings/integrations", labelKey: "sidebar.integrations", icon: "↗" },
  { href: "/settings", labelKey: "sidebar.settings", icon: "⚙" },
];

export function Sidebar({
  user,
  currentPath,
}: {
  user: AuthUser;
  currentPath: string;
}) {
  const { t } = useTranslation();
  const logout = useLogout();
  const { orgId } = useCurrentOrgId();
  const orgs = useMyOrgs();
  const initial = user.name?.[0]?.toUpperCase() ?? user.email[0].toUpperCase();
  // Role used to hide manager-only nav entries. UX nicety — the backend
  // rejects the underlying routes for non-managers regardless.
  const role = orgs.data?.find((o) => o.id === orgId)?.role;
  const isManagerPlus = role === "owner" || role === "admin" || role === "manager";
  const visibleNav = NAV.filter((n) => !n.managerPlus || isManagerPlus);

  return (
    <aside className="w-60 shrink-0 border-r border-(--color-border) bg-(--color-card) flex flex-col">
      <div className="px-4 py-5 border-b border-(--color-border)">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-linear-to-br from-indigo-500 to-violet-500 text-white text-xs font-bold shadow-sm shadow-indigo-500/30">
            TF
          </div>
          <span className="font-semibold text-(--color-fg)">TimeFlow</span>
        </Link>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {visibleNav.map((item) => {
          const active = isActive(currentPath, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors " +
                (active
                  ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                  : "text-(--color-muted) hover:text-(--color-fg) hover:bg-(--color-bg)")
              }
            >
              <span aria-hidden className="w-4 text-center">{item.icon}</span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-(--color-border) p-3 space-y-2">
        <div className="flex items-center gap-2 px-1">
          <div className="h-8 w-8 rounded-full bg-(--color-bg) border border-(--color-border) flex items-center justify-center text-xs font-semibold text-(--color-fg)">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-(--color-fg) truncate">{user.name || user.email}</p>
            <p className="text-[11px] text-(--color-muted) truncate">{user.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="w-full text-left text-xs text-(--color-muted) hover:text-(--color-fg) px-3 py-1.5 rounded-md hover:bg-(--color-bg) transition-colors disabled:opacity-50"
        >
          {logout.isPending ? t("sidebar.signingOut") : t("sidebar.signOut")}
        </button>
      </div>
    </aside>
  );
}

function isActive(path: string, href: string) {
  if (path === href) return true;
  if (!path.startsWith(href + "/")) return false;
  // Don't activate a broader item when a more-specific nav entry matches
  // (e.g. `/settings` shouldn't light up when on `/settings/integrations`
  // because we have a dedicated `/settings/integrations` item above it).
  const moreSpecific = NAV.find(
    (n) => n.href !== href && n.href.startsWith(href + "/") && (n.href === path || path.startsWith(n.href + "/")),
  );
  return !moreSpecific;
}
