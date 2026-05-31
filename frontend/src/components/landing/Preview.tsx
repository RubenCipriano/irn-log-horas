"use client";

import { useTranslation } from "react-i18next";

type Member = {
  initials: string;
  name: string;
  email: string;
  role: string;
  rate: string;
  denied?: boolean;
};

type Connection = {
  provider: string;
  chip: string;
  status: string;
  verified: boolean;
};

// Static illustrative scaffolding for the mockup — names + emails + rates
// stay frozen-English because they stand in for a fake company's data, not
// localizable UI strings. Roles and connection statuses, however, ARE
// real product strings and pick up the active locale via the existing
// `role.*` and `integration.*` catalog keys.
type MemberRole = "manager" | "tech_lead" | "developer" | "viewer";
const MEMBERS: (Omit<Member, "role"> & { roleKey: MemberRole })[] = [
  { initials: "MR", name: "Maria Ribeiro", email: "maria@acme.io", roleKey: "manager", rate: "75.00" },
  { initials: "JS", name: "João Silva", email: "joao@acme.io", roleKey: "tech_lead", rate: "60.00" },
  { initials: "AC", name: "Ana Costa", email: "ana@acme.io", roleKey: "developer", rate: "45.00" },
  { initials: "PF", name: "Pedro Faria", email: "pedro@acme.io", roleKey: "viewer", rate: "45.00", denied: true },
];

const CONNECTIONS: (Omit<Connection, "status"> & { sampleDate: string })[] = [
  { provider: "OpenProject", chip: "OPENPROJECT", sampleDate: "2026-05-29", verified: true },
  { provider: "Jira", chip: "JIRA", sampleDate: "", verified: false },
  { provider: "GitLab", chip: "GITLAB", sampleDate: "2026-05-29", verified: true },
];

export function PreviewLanding() {
  const { t } = useTranslation();

  return (
    <section className="relative max-w-6xl mx-auto px-6 py-20 sm:py-24">
      {/* Soft radial indigo glow — same recipe as the Hero, but anchored
          centrally behind the mockup so the frame appears to float. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(99,102,241,0.45), transparent 60%), radial-gradient(ellipse at 60% 40%, rgba(168,85,247,0.25), transparent 60%)",
        }}
      />

      <header className="text-center max-w-2xl mx-auto mb-12 tf-fade-up">
        <p className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
          {t("marketing.preview.eyebrow")}
        </p>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
          {t("marketing.preview.heading")}
        </h2>
        <p className="mt-3 text-sm sm:text-base text-(--color-muted) leading-relaxed">
          {t("marketing.preview.sub")}
        </p>
      </header>

      <div className="relative rounded-2xl border border-(--color-border) bg-(--color-card) shadow-2xl shadow-indigo-500/10 overflow-hidden">
        {/* macOS-style top chrome */}
        <div className="h-8 flex items-center px-4 gap-2 border-b border-(--color-border) relative">
          <span className="h-3 w-3 rounded-full bg-rose-400" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-amber-400" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-emerald-400" aria-hidden />
          <div className="absolute left-1/2 -translate-x-1/2">
            <span className="rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-1 text-xs text-(--color-muted)">
              {t("marketing.preview.urlBar")}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 sm:p-8">
          {/* Tabs */}
          <nav
            aria-label={t("marketing.preview.tabMembers")}
            className="flex items-center gap-6 border-b border-(--color-border) text-sm"
          >
            <span className="border-b-2 border-indigo-600 -mb-px pb-2 font-medium text-(--color-fg)">
              {t("marketing.preview.tabMembers")}
            </span>
            <span className="pb-2 text-(--color-muted)">
              {t("marketing.preview.tabDetails")}
            </span>
            <span className="pb-2 text-(--color-muted)">
              {t("marketing.preview.tabIntegrations")}
            </span>
            <span className="pb-2 text-(--color-muted)">
              {t("marketing.preview.tabActivity")}
            </span>
          </nav>

          {/* Two-column grid */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6">
            {/* Left column */}
            <div className="space-y-5">
              {/* Sync progress */}
              <div>
                <p className="text-xs text-(--color-muted) mb-2">
                  {t("marketing.preview.syncCaption")}
                </p>
                <div className="h-1.5 bg-(--color-border) rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: "62%" }} />
                </div>
              </div>

              {/* Members table */}
              <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
                {MEMBERS.map((m) => (
                  <li
                    key={m.email}
                    className={`px-3 py-2 flex items-center gap-3 ${m.denied ? "opacity-60" : ""}`}
                  >
                    <span className="h-7 w-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium flex items-center justify-center shrink-0">
                      {m.initials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-(--color-fg) truncate">{m.name}</p>
                      <p className="text-xs text-(--color-muted) truncate">{m.email}</p>
                    </div>
                    <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-xs text-(--color-muted)">
                      {t(`role.${m.roleKey}`)}
                    </span>
                    <span className="tabular-nums text-sm text-(--color-fg) w-12 text-right">
                      {m.rate}
                    </span>
                    <span className="w-5 text-center" aria-hidden>
                      {m.denied ? (
                        <span className="text-rose-500 text-sm">✕</span>
                      ) : (
                        <span className="text-emerald-500 text-sm">✓</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right column */}
            <aside className="hidden md:block">
              <div className="rounded-xl border border-(--color-border) p-4">
                <h3 className="text-base font-semibold text-(--color-fg) mb-3">
                  {t("marketing.preview.connectionsTitle")}
                </h3>
                <ul className="space-y-3">
                  {CONNECTIONS.map((c) => (
                    <li key={c.provider} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-sm bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider">
                          {c.chip}
                        </span>
                        <span className="text-sm text-(--color-fg)">{c.provider}</span>
                      </div>
                      <span
                        className={`text-xs ${
                          c.verified ? "text-emerald-600" : "text-amber-600"
                        }`}
                      >
                        {c.verified
                          ? t("integration.verifyOk", { date: c.sampleDate })
                          : t("integration.verifyNever")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
