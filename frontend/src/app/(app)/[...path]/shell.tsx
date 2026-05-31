"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShellLayout } from "@/components/AppShellLayout";
import { useAuth } from "@/hooks/useAuth";
import { CalendarView } from "@/components/CalendarView";
import { DashboardView } from "@/components/DashboardView";
import { InvoiceDetailView } from "@/components/InvoiceDetailView";
import { InvoiceGenerateView } from "@/components/InvoiceGenerateView";
import { InvoicesView } from "@/components/InvoicesView";
import { MemberDetailView } from "@/components/MemberDetailView";
import { MembersListView } from "@/components/MembersListView";
import { MyTasksView } from "@/components/MyTasksView";
import { TasksAllView } from "@/components/TasksAllView";
import { NotFoundView } from "@/components/NotFoundView";
import { ProjectsView } from "@/components/ProjectsView";
import { ReportsView } from "@/components/ReportsView";
import { SettingsAccountView } from "@/components/SettingsAccountView";
import { SettingsIntegrationsView } from "@/components/SettingsIntegrationsView";
import { SettingsOrgPolicyView } from "@/components/SettingsOrgPolicyView";
import { ProjectDetailView } from "@/components/ProjectDetailView";

// Client-side SPA shell. The same static HTML (__shell__.html) is served
// by nginx for every authed URL — this component reads the real pathname
// from the browser and dispatches to the right view inside AppShellLayout.

type Route = {
  title: string;
  render: () => ReactNode;
};

// Route table. Order matters only insofar as prefix-matches; exact paths
// are tried first via the Map lookup, then prefix patterns fall through.
const EXACT_ROUTES: Record<string, Route> = {
  "/dashboard": { title: "Dashboard", render: () => <DashboardView /> },
  "/calendar": { title: "Calendar", render: () => <CalendarView /> },
  "/projects": { title: "Projects", render: () => <ProjectsView /> },
  "/members": { title: "Members", render: () => <MembersListView /> },
  "/tasks": { title: "All tasks", render: () => <TasksAllView /> },
  "/tasks/me": { title: "My tasks", render: () => <MyTasksView /> },
  "/invoices": { title: "Invoices", render: () => <InvoicesView /> },
  "/invoices/new": { title: "New invoice", render: () => <InvoiceGenerateView /> },
  "/reports": { title: "Reports", render: () => <ReportsView /> },
  "/settings": { title: "Account", render: () => <SettingsAccountView /> },
  "/settings/account": { title: "Account", render: () => <SettingsAccountView /> },
  // Legacy Settings → Members route. The screen has been collapsed into
  // /members + the member-detail page. We keep the route key for a release
  // window so stale bookmarks land somewhere sensible instead of 404ing.
  "/settings/members": { title: "Members", render: () => <RedirectTo to="/members" /> },
  "/settings/org-policy": { title: "Org policy", render: () => <SettingsOrgPolicyView /> },
  "/settings/integrations": { title: "Integrations", render: () => <SettingsIntegrationsView /> },
};

// Dynamic prefix patterns. Tried AFTER exact-route lookup misses.
// Each captures a single trailing segment via a regex match.
const PREFIX_ROUTES: { pattern: RegExp; title: string; render: (m: RegExpMatchArray) => ReactNode }[] = [
  {
    pattern: /^\/members\/([^/]+)$/,
    title: "Member",
    render: (m) => <MemberDetailView userId={m[1]} />,
  },
  {
    pattern: /^\/projects\/([^/]+)$/,
    title: "Project",
    render: (m) => <ProjectDetailView projectId={m[1]} />,
  },
  {
    pattern: /^\/invoices\/([^/]+)$/,
    title: "Invoice",
    render: (m) => <InvoiceDetailView invoiceId={m[1]} />,
  },
];

function resolveRoute(pathname: string): { title: string; node: ReactNode } {
  const exact = EXACT_ROUTES[pathname];
  if (exact) return { title: exact.title, node: exact.render() };
  for (const r of PREFIX_ROUTES) {
    const match = pathname.match(r.pattern);
    if (match) return { title: r.title, node: r.render(match) };
  }
  return { title: "Not found", node: <NotFoundView path={pathname} /> };
}

export function AppShell() {
  // SSG output has no idea what the real URL is; `mounted` gates dispatch
  // so the server-rendered HTML and the first client paint match (no
  // hydration mismatch).
  const [mounted, setMounted] = useState(false);
  const [pathname, setPathname] = useState("");
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    setPathname(window.location.pathname);
    setMounted(true);
  }, []);

  // Auth gate. We can't redirect during SSG (no router yet), so wait
  // until the auth query has resolved on the client.
  useEffect(() => {
    if (!mounted) return;
    if (auth.isLoading) return;
    if (!auth.isAuthenticated) {
      const next = encodeURIComponent(pathname || "/dashboard");
      router.replace(`/login?next=${next}`);
    }
  }, [mounted, auth.isAuthenticated, auth.isLoading, pathname, router]);

  if (!mounted || auth.isLoading) {
    return <BootScreen label="Loading…" />;
  }

  if (auth.error) {
    return (
      <BootScreen
        label={`Backend unreachable: ${String((auth.error as Error).message)}`}
        tone="error"
      />
    );
  }

  if (!auth.isAuthenticated || !auth.user) {
    // Redirect already fired; render a quiet placeholder until it lands.
    return <BootScreen label="Redirecting to sign in…" />;
  }

  const { title, node } = resolveRoute(pathname);

  return (
    <AppShellLayout user={auth.user} currentPath={pathname} title={title}>
      {node}
    </AppShellLayout>
  );
}

// Tiny client-only redirect for retired routes. Returns null so the
// shell renders nothing while router.replace lands.
function RedirectTo({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}

function BootScreen({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white text-xs font-bold shadow-md shadow-indigo-500/30">
        TF
      </div>
      <p
        className={
          "text-sm " +
          (tone === "error" ? "text-rose-600 dark:text-rose-300" : "text-(--color-muted)")
        }
      >
        {label}
      </p>
      {tone === "error" && (
        <Link href="/" className="text-xs text-indigo-600 hover:underline">
          ← Back to marketing
        </Link>
      )}
    </main>
  );
}
