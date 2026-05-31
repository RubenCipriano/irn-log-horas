"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useMyOrgs } from "@/hooks/useOrgs";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useExpectedHours, useWorklogs } from "@/hooks/useWorklogs";

// Lightweight org-summary landing. Picks the user's default org and
// shows this week's expected vs logged hours, plus quick links into the
// calendar / projects / settings.
export function DashboardView() {
  const { t } = useTranslation();
  const auth = useAuth();
  const orgs = useMyOrgs();
  const { orgId: defaultOrg } = useCurrentOrgId();

  // Current ISO week range — Monday to Sunday.
  const { from, to } = currentWeek();
  const expected = useExpectedHours(defaultOrg, from, to);
  const logs = useWorklogs(defaultOrg, from, to);

  const totalLogged = logs.data?.reduce((acc, l) => acc + l.hours, 0) ?? 0;
  const totalExpected = expected.data?.total ?? 0;
  const delta = totalLogged - totalExpected;

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1 tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">{t("dashboard.title")}</p>
        <h2 className="text-2xl font-bold text-(--color-fg)">
          {auth.user ? t("dashboard.welcome", { name: firstName(auth.user.name) }) : t("common.loading")}
        </h2>
      </header>

      {!defaultOrg && !orgs.isLoading && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-5 max-w-xl tf-fade-up">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {t("dashboard.noOrg")}
          </p>
          <p className="text-sm text-amber-800/80 dark:text-amber-200/80 mt-1">
            {t("dashboard.noOrgHint")}
          </p>
          <Link
            href="/onboarding/create-org"
            className="inline-block mt-3 rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            {t("dashboard.createOrg")}
          </Link>
        </div>
      )}

      {defaultOrg && (
        <>
          <section className="grid sm:grid-cols-3 gap-4 max-w-3xl tf-fade-up">
            <StatCard
              label={t("dashboard.stat.logged")}
              value={totalLogged.toFixed(1)}
              hint={t("dashboard.stat.range", { from: from.slice(5), to: to.slice(5) })}
            />
            <StatCard
              label={t("dashboard.stat.expected")}
              value={totalExpected.toFixed(1)}
              hint={t("dashboard.stat.expectedHint")}
            />
            <StatCard
              label={delta >= 0 ? t("dashboard.stat.over") : t("dashboard.stat.under")}
              value={Math.abs(delta).toFixed(1)}
              tone={delta < 0 ? "warn" : "ok"}
              hint={delta < 0 ? t("dashboard.stat.underHint") : t("dashboard.stat.overHint")}
            />
          </section>

          <section className="space-y-3 tf-fade-up">
            <h3 className="text-sm font-semibold text-(--color-fg)">{t("dashboard.quickLinks")}</h3>
            <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
              <Tile href="/calendar" title={t("sidebar.calendar")} body={t("dashboard.tile.calendar.body")} />
              <Tile href="/projects" title={t("sidebar.projects")} body={t("dashboard.tile.projects.body")} />
              <Tile href="/members" title={t("dashboard.tile.members")} body={t("dashboard.tile.members.body")} />
              <Tile href="/settings/integrations" title={t("sidebar.integrations")} body={t("dashboard.tile.integrations.body")} />
            </div>
          </section>
        </>
      )}

      {orgs.data && orgs.data.length > 1 && (
        <section className="space-y-2 tf-fade-up">
          <h3 className="text-sm font-semibold text-(--color-fg)">{t("dashboard.yourOrgs")}</h3>
          <ul className="space-y-1">
            {orgs.data.map((o) => (
              <li key={o.id} className="text-sm">
                <span className="text-(--color-fg)">{o.name}</span>{" "}
                <span className="text-(--color-muted)">· {o.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueTone =
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
    "text-(--color-fg)";
  return (
    <div className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 shadow-sm">
      <p className="text-xs font-medium text-(--color-muted) uppercase tracking-wider">{label}</p>
      <p className={"text-3xl font-bold mt-1 " + valueTone}>{value}</p>
      {hint && <p className="text-xs text-(--color-muted) mt-1">{hint}</p>}
    </div>
  );
}

function Tile({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-(--color-border) bg-(--color-card) p-4 hover:border-indigo-300 transition-colors"
    >
      <p className="text-sm font-semibold text-(--color-fg)">{title} →</p>
      <p className="text-xs text-(--color-muted) mt-1">{body}</p>
    </Link>
  );
}

function firstName(full: string) {
  return full.split(/\s+/)[0] || full;
}

function currentWeek(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day; // Sunday → -6, Monday → 0
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
