"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useProjects, useProjectChildren, useUpdateProject, useDeleteProject } from "@/hooks/useProjects";
import { useTasks } from "@/hooks/useTasks";
import { useOrg } from "@/hooks/useOrgs";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateIntegration,
  useDeleteIntegration,
  useEnqueueSync,
  useIntegrations,
  useSyncJobs,
  useTestIntegration,
  type IntegrationProvider,
} from "@/hooks/useIntegrations";
import { ProjectMembersEditor } from "@/components/ProjectMembersEditor";
import { ProjectPolicyEditor } from "@/components/ProjectPolicyEditor";
import type { IntegrationConnectionItem, ProjectItem, SyncJobItem } from "@/lib/types";

type Tab = "overview" | "members" | "projects" | "tasks" | "integrations" | "policy";

const PROVIDERS: { key: IntegrationProvider; label: string; needsBaseUrl: boolean; needsEmail: boolean }[] = [
  { key: "openproject", label: "OpenProject", needsBaseUrl: true, needsEmail: false },
  { key: "jira", label: "Jira", needsBaseUrl: true, needsEmail: true },
  { key: "linear", label: "Linear", needsBaseUrl: false, needsEmail: false },
  { key: "gitlab", label: "GitLab", needsBaseUrl: true, needsEmail: false },
];

// /projects/:id — engagement project page with four tabs:
//   * Detalhes      — name + code + bill_rate + billing-party fields
//   * Membros       — ProjectMembersEditor (role + rate + denied)
//   * Tarefas       — quick read-only list
//   * Integrações   — per-member upstream connections owned by the
//                     (project, user, provider) tuple. Each member sees
//                     their own; manager+ on the org sees all.
export function ProjectDetailView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const projects = useProjects(orgId, true);
  const org = useOrg(orgId);
  const update = useUpdateProject(orgId);
  const del = useDeleteProject(orgId);

  const project = projects.data?.find((p) => p.id === projectId) ?? null;

  const yourRole = org.data?.yourRole;
  const canEdit = yourRole === "owner" || yourRole === "admin" || yourRole === "manager" || yourRole === "tech_lead";

  const [tab, setTab] = useState<Tab>("members");

  if (!orgId) return <div className="p-6 text-sm text-(--color-muted)">{t("common.pickOrgFirst")}</div>;
  if (projects.isLoading) return <div className="p-6 text-sm text-(--color-muted)">{t("common.loading")}</div>;
  if (!project) return (
    <div className="p-6 max-w-5xl mx-auto space-y-3">
      <p className="text-sm text-(--color-muted)">{t("project.notFound")}</p>
      <Link href="/projects" className="text-xs text-indigo-600 hover:underline">← {t("sidebar.projects")}</Link>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link href="/projects" className="text-xs text-indigo-600 hover:underline">← {t("sidebar.projects")}</Link>

      <header className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-(--color-fg) truncate">{project.name}</h1>
          <p className="text-xs text-(--color-muted) mt-1">
            {project.archived ? `${t("project.archivedBadge")} · ` : ""}
            {project.code ? `${project.code} · ` : ""}
            {project.contactName || project.contactEmail || t("project.noContact")}
          </p>
        </div>
      </header>

      <nav className="flex gap-2 border-b border-(--color-border)">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>{t("project.tab.details")}</TabBtn>
        <TabBtn active={tab === "members"} onClick={() => setTab("members")}>{t("project.tab.members")}</TabBtn>
        <TabBtn active={tab === "projects"} onClick={() => setTab("projects")}>{t("project.tab.projects")}</TabBtn>
        <TabBtn active={tab === "tasks"} onClick={() => setTab("tasks")}>{t("project.tab.tasks")}</TabBtn>
        <TabBtn active={tab === "integrations"} onClick={() => setTab("integrations")}>{t("project.tab.integrations")}</TabBtn>
        <TabBtn active={tab === "policy"} onClick={() => setTab("policy")}>{t("project.policy.tab")}</TabBtn>
      </nav>

      {tab === "overview" && (
        <OverviewTab
          projectId={projectId}
          canEdit={canEdit}
          project={project}
          update={update}
          del={del}
        />
      )}

      {tab === "members" && (
        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5">
          <ProjectMembersEditor orgId={orgId} projectId={projectId} mode="page" />
        </section>
      )}

      {tab === "projects" && (
        <ProjectsTab orgId={orgId} projectId={projectId} />
      )}

      {tab === "tasks" && (
        <TasksTab orgId={orgId} projectId={projectId} />
      )}

      {tab === "integrations" && (
        <IntegrationsTab orgId={orgId} projectId={projectId} />
      )}

      {tab === "policy" && (
        <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5">
          <ProjectPolicyEditor projectId={projectId} />
        </section>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${active
        ? "border-indigo-600 text-(--color-fg)"
        : "border-transparent text-(--color-muted) hover:text-(--color-fg)"}`}
    >
      {children}
    </button>
  );
}

function OverviewTab({
  projectId,
  canEdit,
  project,
  update,
  del,
}: {
  projectId: string;
  canEdit: boolean;
  project: ProjectItem;
  update: ReturnType<typeof useUpdateProject>;
  del: ReturnType<typeof useDeleteProject>;
}) {
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code ?? "");
  const [billRate, setBillRate] = useState(project.billRate === null ? "" : String(project.billRate));
  const [defaultBillRate, setDefaultBillRate] = useState(
    project.defaultBillRate === null ? "" : String(project.defaultBillRate),
  );
  const [contactEmail, setContactEmail] = useState(project.contactEmail ?? "");
  const [contactName, setContactName] = useState(project.contactName ?? "");
  const [taxId, setTaxId] = useState(project.taxId ?? "");
  const [address, setAddress] = useState(project.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  // Re-sync local form when the cache pushes a new project snapshot.
  useEffect(() => {
    setName(project.name);
    setCode(project.code ?? "");
    setBillRate(project.billRate === null ? "" : String(project.billRate));
    setDefaultBillRate(project.defaultBillRate === null ? "" : String(project.defaultBillRate));
    setContactEmail(project.contactEmail ?? "");
    setContactName(project.contactName ?? "");
    setTaxId(project.taxId ?? "");
    setAddress(project.address ?? "");
  }, [project]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const rateStr = billRate.trim();
      const defaultStr = defaultBillRate.trim();
      await update.mutateAsync({
        projectId,
        patch: {
          name: name.trim(),
          code: code.trim() === "" ? null : code.trim(),
          ...(rateStr === "" ? { clearBillRate: true } : { billRate: Number(rateStr) }),
          ...(defaultStr === "" ? { clearDefaultBillRate: true } : { defaultBillRate: Number(defaultStr) }),
          contactEmail: contactEmail.trim() === "" ? null : contactEmail.trim(),
          contactName: contactName.trim() === "" ? null : contactName.trim(),
          taxId: taxId.trim() === "" ? null : taxId.trim(),
          address: address.trim() === "" ? null : address.trim(),
        },
      });
    } catch (err) {
      setError(axiosErr(err) ?? t("project.overview.saveFailed"));
    }
  }

  async function onArchiveToggle() {
    setError(null);
    try {
      await update.mutateAsync({ projectId, patch: { archived: !project.archived } });
    } catch (err) {
      setError(axiosErr(err) ?? t("project.overview.archiveFailed"));
    }
  }

  async function onDelete() {
    setError(null);
    if (!confirm(t("project.overview.deleteConfirm", { name: project.name }))) return;
    try {
      await del.mutateAsync(projectId);
      window.location.href = "/projects";
    } catch (err) {
      setError(axiosErr(err) ?? t("project.overview.deleteFailed"));
    }
  }

  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
      <form onSubmit={onSave} className="grid grid-cols-2 gap-3">
        <label className="col-span-2 space-y-1">
          <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.name")}</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            className={inputCls()}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.code")}</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!canEdit}
            className={inputCls()}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.billRate")}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={billRate}
            onChange={(e) => setBillRate(e.target.value)}
            disabled={!canEdit}
            placeholder={t("project.overview.billRatePlaceholder")}
            className={inputCls()}
          />
        </label>

        <fieldset className="col-span-2 grid grid-cols-2 gap-3 border border-(--color-border) rounded-md p-3">
          <legend className="px-2 text-xs font-medium text-(--color-fg)">{t("project.overview.billingParty")}</legend>
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.contactName")}</span>
            <input
              type="text"
              maxLength={200}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={!canEdit}
              className={inputCls()}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.contactEmail")}</span>
            <input
              type="email"
              maxLength={200}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={!canEdit}
              className={inputCls()}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.taxId")}</span>
            <input
              type="text"
              maxLength={60}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              disabled={!canEdit}
              className={inputCls()}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.defaultBillRate")}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={defaultBillRate}
              onChange={(e) => setDefaultBillRate(e.target.value)}
              disabled={!canEdit}
              placeholder={t("project.overview.defaultBillRatePlaceholder")}
              className={inputCls()}
            />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">{t("project.overview.address")}</span>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit}
              rows={2}
              className={inputCls()}
            />
          </label>
        </fieldset>

        {error && (
          <p className="col-span-2 text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="col-span-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onArchiveToggle}
              className="text-xs rounded-md border border-(--color-border) px-3 py-1.5 hover:bg-(--color-bg)"
            >
              {project.archived ? t("common.restore") : t("common.archive")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={del.isPending}
              className="text-xs text-rose-500 hover:text-rose-700 px-3 py-1.5 disabled:opacity-50"
            >
              {t("common.delete")}
            </button>
            <button
              type="submit"
              disabled={update.isPending}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {update.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

function ProjectsTab({ orgId, projectId }: { orgId: string; projectId: string }) {
  // One-level-deep child list. Each row links to that child's own detail
  // page so the user can drill in (e.g. engagement → wrapper → upstream
  // sub-projects → tasks).
  const { t } = useTranslation();
  const children = useProjectChildren(orgId, projectId);
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg)">{t("project.subprojects.title")}</h3>
        <p className="text-xs text-(--color-muted)">
          {t("project.subprojects.subtitle", { count: children.data?.length ?? 0 })}
        </p>
      </header>
      {children.isLoading && <p className="text-xs text-(--color-muted)">{t("common.loading")}</p>}
      {children.data && children.data.length === 0 && (
        <p className="text-xs text-(--color-muted)">{t("project.subprojects.empty")}</p>
      )}
      {children.data && children.data.length > 0 && (
        <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
          {children.data.map((c) => (
            <li key={c.id}>
              <Link
                href={`/projects/${c.id}`}
                className="px-3 py-2 text-xs flex items-center gap-2 hover:bg-(--color-bg)"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-(--color-fg) truncate flex items-center gap-2">
                    <span className="truncate">{c.name}</span>
                    {c.code && <span className="text-(--color-muted) font-mono text-[10px]">{c.code}</span>}
                    {c.archived && (
                      <span className="text-[10px] uppercase tracking-wider text-(--color-muted) border border-(--color-border) rounded px-1">
                        {t("project.archivedBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-(--color-muted) text-[11px]">
                    {t(`project.type.${typeKey(c.type)}`)}
                    {c.upstreamProjectId ? ` · #${c.upstreamProjectId}` : ""}
                  </div>
                </div>
                <span className="text-[10px] text-(--color-muted) shrink-0">
                  {c.childProjectCount > 0
                    ? t("project.subprojects.countProjects", { count: c.childProjectCount })
                    : t("project.subprojects.countTasks", { count: c.taskCount })}
                </span>
                <span className="text-(--color-muted) shrink-0">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Narrow the backend's project-type string to a known catalog suffix.
// Any unknown value falls back to "default" — `project.type.default`.
function typeKey(t: string): string {
  switch (t) {
    case "integration":
    case "subproject":
    case "team":
    case "module":
    case "service":
    case "epic":
    case "program":
      return t;
    default:
      return "default";
  }
}

function TasksTab({ orgId, projectId }: { orgId: string; projectId: string }) {
  // Roll up tasks from this engagement + every direct sub-project so the
  // user sees everything they can log time against in one place.
  const { t } = useTranslation();
  const tasks = useTasks(orgId, projectId, { includeDescendants: true });
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg)">{t("project.tasks.title")}</h3>
        <p className="text-xs text-(--color-muted)">
          {t("project.tasks.subtitle", { count: tasks.data?.length ?? 0 })}
        </p>
      </header>
      {tasks.isLoading && <p className="text-xs text-(--color-muted)">{t("common.loading")}</p>}
      {tasks.data && tasks.data.length === 0 && (
        <p className="text-xs text-(--color-muted)">{t("project.tasks.empty")}</p>
      )}
      {tasks.data && tasks.data.length > 0 && (
        <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
          {tasks.data.map((t) => (
            <li key={t.id} className="px-3 py-2 text-xs flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-(--color-fg) truncate">{t.title}</div>
              </div>
              <span className="text-xs text-(--color-muted) uppercase tracking-wider border border-(--color-border) rounded px-1.5 py-0.5">
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Per-project integrations. Each row is a (member, provider) connection.
// Adding is gated by being a project member; deleting/syncing is gated by
// ownership (or manager+ on the org).
function IntegrationsTab({ orgId, projectId }: { orgId: string; projectId: string }) {
  const { t } = useTranslation();
  const me = useAuth();
  const myUserId = me.user?.id ?? null;
  const list = useIntegrations(orgId, { projectId });
  const test = useTestIntegration(orgId);
  const sync = useEnqueueSync(orgId);
  const del = useDeleteIntegration(orgId);

  const myConn = (list.data ?? []).find((c) => c.userId === myUserId) ?? null;
  const othersConn = (list.data ?? []).filter((c) => c.userId !== myUserId);

  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-5">
      <header>
        <h3 className="text-sm font-semibold text-(--color-fg)">{t("project.integrations.title")}</h3>
        <p className="text-xs text-(--color-muted)">
          {t("project.integrations.subtitle")}
        </p>
      </header>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-(--color-muted) uppercase tracking-wider">{t("project.integrations.mine")}</h4>
        {myConn ? (
          <ConnectionRow
            orgId={orgId}
            conn={myConn}
            ownerLabel={t("project.integrations.you")}
            canManage={true}
            onTest={() => test.mutate(myConn.id)}
            onSync={(full) => sync.mutate({ connId: myConn.id, full })}
            onDelete={() => {
              if (confirm(t("project.integrations.deleteConfirm", { name: myConn.name }))) {
                del.mutate(myConn.id);
              }
            }}
            busy={test.isPending || sync.isPending || del.isPending}
          />
        ) : (
          <AddIntegrationForm orgId={orgId} projectId={projectId} />
        )}
      </div>

      {othersConn.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-(--color-muted) uppercase tracking-wider">{t("project.integrations.others", { count: othersConn.length })}</h4>
          {othersConn.map((c) => (
            <ConnectionRow
              key={c.id}
              orgId={orgId}
              conn={c}
              ownerLabel={c.userName ?? "—"}
              canManage={false}
              busy={false}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectionRow({
  orgId, conn, ownerLabel, canManage, onTest, onSync, onDelete, busy,
}: {
  orgId: string;
  conn: IntegrationConnectionItem;
  ownerLabel: string;
  canManage: boolean;
  onTest?: () => void;
  onSync?: (full: boolean) => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  // Poll the latest sync job for this connection so the progress bar
  // advances while a sync is in flight. Idle = no poll (refetchInterval
  // returns false when no live job).
  const jobs = useSyncJobs(orgId, { connectionId: conn.id, limit: 1, pollMs: 2000 });
  const latest = jobs.data?.[0];

  const verifyBadge = conn.lastVerifyError
    ? { tone: "rose", label: t("integration.verifyFailed", { error: conn.lastVerifyError }) }
    : conn.lastVerifiedAt
    ? { tone: "emerald", label: t("integration.verifyOk", { date: new Date(conn.lastVerifiedAt).toISOString().slice(0, 10) }) }
    : { tone: "amber", label: t("integration.verifyNever") };

  return (
    <div className="rounded-md border border-(--color-border) p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-(--color-fg) flex items-center gap-2">
            <span className="truncate">{conn.name}</span>
            <span className="text-[10px] uppercase tracking-wider border border-(--color-border) rounded px-1 py-0.5 text-(--color-muted)">
              {conn.provider}
            </span>
          </p>
          <p className="text-xs text-(--color-muted) mt-0.5">
            {ownerLabel}
            {conn.upstreamUserName ? ` · ${conn.upstreamUserName}` : ""}
          </p>
          <p className={`text-xs mt-1 text-${verifyBadge.tone}-600 dark:text-${verifyBadge.tone}-400`}>
            {verifyBadge.label}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={onTest} disabled={busy} className="text-xs rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-50">
              {t("integration.test")}
            </button>
            <button onClick={() => onSync?.(false)} disabled={busy} className="text-xs rounded-md bg-indigo-600 text-white px-2 py-1 hover:bg-indigo-700 disabled:opacity-50">
              {t("integration.sync")}
            </button>
            <button
              onClick={() => {
                if (confirm(t("integration.fullResyncConfirm"))) onSync?.(true);
              }}
              disabled={busy}
              className="text-xs rounded-md border border-(--color-border) px-2 py-1 hover:bg-(--color-bg) disabled:opacity-50"
              title="Bypass watermarks; pulls everything"
            >
              {t("integration.fullResync")}
            </button>
            <button onClick={onDelete} disabled={busy} className="text-xs text-rose-500 hover:text-rose-700 px-2 py-1 disabled:opacity-50">
              {t("integration.delete")}
            </button>
          </div>
        )}
      </div>
      {latest && <SyncStatus job={latest} />}
    </div>
  );
}

function AddIntegrationForm({ orgId, projectId }: { orgId: string; projectId: string }) {
  const { t } = useTranslation();
  const create = useCreateIntegration(orgId);
  const [provider, setProvider] = useState<IntegrationProvider>("openproject");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const config = PROVIDERS.find((p) => p.key === provider)!;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        provider,
        name: name.trim(),
        projectId,
        baseUrl: config.needsBaseUrl ? baseUrl.trim() : undefined,
        token,
        email: config.needsEmail ? email.trim() : undefined,
      });
      setName(""); setBaseUrl(""); setToken(""); setEmail("");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const code = err.response?.data?.code;
        const msg = err.response?.data?.error;
        if (code === "not_project_member") {
          setError(t("integration.add.errorNotProjectMember"));
        } else if (code === "connection_taken") {
          setError(t("integration.add.errorConnectionTaken"));
        } else {
          setError(msg ?? t("integration.add.errorGeneric"));
        }
      } else setError(t("integration.add.errorGeneric"));
    }
  }

  const tokenLabelKey = `integration.add.token.${provider}` as const;

  return (
    <form onSubmit={onSubmit} autoComplete="off" className="rounded-md border border-(--color-border) p-3 space-y-3">
      <p className="text-xs text-(--color-muted)">
        {t("integration.add.verifyHint")}
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">{t("integration.add.provider")}</span>
        <select value={provider} onChange={(e) => setProvider(e.target.value as IntegrationProvider)} className={inputCls()}>
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">{t("integration.add.name")}</span>
        <input
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("integration.add.namePlaceholder", { provider })}
          className={inputCls()}
        />
      </label>
      {config.needsBaseUrl && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-(--color-fg)">{t("integration.add.baseUrl")}</span>
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={baseUrlPlaceholder(provider)}
            className={inputCls()}
            autoComplete="off"
            name="tf-integration-base-url"
            data-1p-ignore
            data-lpignore="true"
          />
        </label>
      )}
      {config.needsEmail && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-(--color-fg)">{t("integration.add.email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            name="tf-integration-email"
            className={inputCls()}
          />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-(--color-fg)">
          {t(tokenLabelKey)}
        </span>
        <input
          type="password"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          className={inputCls()}
        />
        <p className="text-[11px] text-(--color-muted)">{t("integration.add.tokenHint")}</p>
      </label>
      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
          {error}
        </p>
      )}
      <button type="submit" disabled={create.isPending} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
        {create.isPending ? t("integration.add.submitting") : t("integration.add.submit")}
      </button>
    </form>
  );
}

function SyncStatus({ job }: { job: SyncJobItem }) {
  const { t } = useTranslation();
  if (job.status === "succeeded") {
    const summary = job.summary ? safeJson(job.summary) : null;
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        {t("integration.lastSyncOk")}
        {summary?.tasksUpserted != null ? ` · ${t("integration.tasksUpserted", { count: summary.tasksUpserted as number })}` : ""}
        {summary?.worklogsImported != null ? ` · ${t("integration.worklogsImported", { count: summary.worklogsImported as number })}` : ""}
      </p>
    );
  }
  if (job.status === "failed") {
    return <p className="text-xs text-rose-600 dark:text-rose-400">{t("integration.lastSyncFailed", { message: job.errorMessage ?? t("integration.lastSyncMessageUnknown") })}</p>;
  }
  if (job.status === "cancelled") {
    return <p className="text-xs text-amber-600 dark:text-amber-400">{t("integration.lastSyncCancelled")}</p>;
  }
  // queued / running — show progress bar
  const pct = job.progressTotal > 0 ? Math.min(100, (job.progressDone / job.progressTotal) * 100) : 5;
  return (
    <div className="space-y-1">
      <p className="text-xs text-(--color-muted)">
        {job.status === "queued"
          ? t("integration.queued")
          : t("integration.running", { done: job.progressDone, total: Math.max(0, job.progressTotal) })}
      </p>
      <div className="h-1.5 bg-(--color-bg) rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

function baseUrlPlaceholder(p: IntegrationProvider) {
  return p === "openproject" ? "https://op.your-company.com"
    : p === "jira" ? "https://your-company.atlassian.net"
    : p === "gitlab" ? "https://gitlab.com"
    : "";
}

function inputCls() {
  return "rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50 w-full";
}

function axiosErr(err: unknown): string | null {
  if (axios.isAxiosError(err) && err.response?.data?.error) return String(err.response.data.error);
  return null;
}
