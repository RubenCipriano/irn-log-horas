"use client";

import Link from "next/link";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useIntegrations } from "@/hooks/useIntegrations";
import { SettingsNav } from "@/components/SettingsNav";

// Post-collapse: integrations are per-(project, member). This page shows
// the org-wide list (filterable). Adding / re-syncing / deleting happens
// on the engagement project's Integrations tab where the user is a
// member — the consent surface lives next to the project context.
export function SettingsIntegrationsView() {
  const { orgId } = useCurrentOrgId();
  const list = useIntegrations(orgId);

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">Pick an org first.</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <SettingsNav />
      <header className="tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">Integrations</p>
        <h2 className="text-xl font-semibold text-(--color-fg) mt-1">Connections</h2>
        <p className="text-sm text-(--color-muted) mt-1">
          One connection per (project, member, provider). To add a new
          integration, open the project page and use its Integrations tab.
        </p>
      </header>

      <section className="space-y-3 tf-fade-up">
        {list.isLoading && <p className="text-sm text-(--color-muted)">Loading…</p>}
        {list.data && list.data.length === 0 && (
          <p className="text-sm text-(--color-muted)">No integrations yet.</p>
        )}

        {list.data && list.data.map((c) => (
          <div key={c.id} className="rounded-xl border border-(--color-border) bg-(--color-card) p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-(--color-fg) flex items-center gap-2">
                <span className="truncate">{c.name}</span>
                <span className="text-[10px] uppercase tracking-wider border border-(--color-border) rounded px-1.5 py-0.5 text-(--color-muted)">
                  {c.provider}
                </span>
              </p>
              <p className="text-xs text-(--color-muted) mt-1">
                {c.projectName ?? "—"} · {c.userName ?? "—"}
                {c.upstreamUserName ? ` · ${c.upstreamUserName} upstream` : ""}
              </p>
              {c.lastVerifyError ? (
                <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                  Verify failed ({c.lastVerifyError})
                </p>
              ) : c.lastVerifiedAt ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                  Verified {new Date(c.lastVerifiedAt).toISOString().slice(0, 10)}
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Never verified</p>
              )}
            </div>
            <Link
              href={`/projects/${c.projectId}`}
              className="text-xs rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg)"
            >
              Manage →
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}
