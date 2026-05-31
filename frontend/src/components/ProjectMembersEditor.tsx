"use client";

import Link from "next/link";
import { useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  ROLE_ON_PROJECT_OPTIONS,
  useAllocateProjectMember,
  useProjectMembers,
  useUnallocateProjectMember,
  useUpdateProjectMember,
  type RoleOnProject,
} from "@/hooks/useMemberAllocations";
import { useMembers } from "@/hooks/useMembers";
import { useOrg } from "@/hooks/useOrgs";

// Shared editor for project allocations. Two modes:
//  - `panel`: lean shape used inside the side panel in /projects.
//    Read-only row body (name + rate badge), unallocate button, plus a
//    "Manage all members →" link to the dedicated page. Quick-add at the
//    bottom mirrors the legacy form so the muscle-memory stays intact.
//  - `page`: full row layout with role picker, rate input, deny toggle.
//    Lives at /projects/:id under the Members tab.
//
// Both modes share the same hooks + cache invalidations; mode flips the
// UI density only.
export function ProjectMembersEditor({
  orgId,
  projectId,
  mode,
}: {
  orgId: string;
  projectId: string;
  mode: "panel" | "page";
}) {
  const { t } = useTranslation();
  const allocated = useProjectMembers(orgId, projectId);
  const orgMembers = useMembers(orgId);
  const org = useOrg(orgId);

  const allocate = useAllocateProjectMember(orgId, projectId);
  const update = useUpdateProjectMember(orgId, projectId);
  const unallocate = useUnallocateProjectMember(orgId, projectId);

  const yourRole = org.data?.yourRole;
  // Tech-lead+ can edit per the v1 decision (the older Manager-only cost
  // gate was dropped on the backend too).
  const canEdit = yourRole === "owner" || yourRole === "admin" || yourRole === "manager" || yourRole === "tech_lead";

  const [error, setError] = useState<string | null>(null);
  const [pickedUserId, setPickedUserId] = useState("");
  const [pickedRole, setPickedRole] = useState<RoleOnProject>("developer");

  const allocatedIds = new Set((allocated.data ?? []).map((a) => a.userId));
  const available = (orgMembers.data ?? []).filter((m) => !allocatedIds.has(m.userId));

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedUserId) return;
    setError(null);
    try {
      // Rate is no longer set from this form — the member's compensation
      // lives on /members/{userId}. Per-project cost_per_hour overrides
      // can still be set via the backend's PATCH endpoint but are not
      // surfaced here.
      await allocate.mutateAsync({
        userId: pickedUserId,
        roleOnProject: pickedRole,
      });
      setPickedUserId("");
      setPickedRole("developer");
    } catch (err) {
      setError(axiosErr(err, t) ?? t("members.allocateFailed"));
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-(--color-fg)">{t("members.title")}</h3>
          <p className="text-xs text-(--color-muted)">
            {t("members.subtitle", { count: allocated.data?.length ?? 0 })}
          </p>
        </div>
        {mode === "panel" && (
          <Link
            href={`/projects/${projectId}`}
            className="text-xs text-indigo-600 hover:underline shrink-0"
          >
            {t("members.manageAll")}
          </Link>
        )}
      </header>

      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
          {error}
        </p>
      )}

      {allocated.isLoading && <p className="text-xs text-(--color-muted)">{t("common.loading")}</p>}
      {allocated.data && allocated.data.length === 0 && (
        <p className="text-xs text-(--color-muted)">{t("members.empty")}</p>
      )}

      {allocated.data && allocated.data.length > 0 && (
        <ul className="rounded-md border border-(--color-border) divide-y divide-(--color-border)">
          {allocated.data.map((m) => (
            <Row
              key={m.userId}
              userId={m.userId}
              name={m.name || m.email}
              email={m.email}
              role={m.roleOnProject}
              denied={m.denied}
              rate={m.costPerHour}
              canEdit={canEdit}
              mode={mode}
              onUpdate={async (payload) => {
                setError(null);
                try {
                  await update.mutateAsync({ userId: m.userId, ...payload });
                } catch (err) {
                  setError(axiosErr(err, t) ?? t("members.updateFailed"));
                }
              }}
              onUnallocate={async () => {
                setError(null);
                if (!confirm(t("members.removeConfirm", { name: m.name || m.email }))) return;
                try {
                  await unallocate.mutateAsync(m.userId);
                } catch (err) {
                  setError(axiosErr(err, t) ?? t("members.removeFailed"));
                }
              }}
              busy={update.isPending || unallocate.isPending}
            />
          ))}
        </ul>
      )}

      {canEdit && available.length > 0 && (
        <form onSubmit={onAdd} className={mode === "page" ? "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] gap-2" : "flex items-center gap-2"}>
          <select
            value={pickedUserId}
            onChange={(e) => setPickedUserId(e.target.value)}
            className={inputCls() + (mode === "page" ? "" : " flex-1")}
            aria-label={t("members.title")}
          >
            <option value="">{t("members.pickMember")}</option>
            {available.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name || m.email}</option>
            ))}
          </select>
          {mode === "page" && (
            <select
              value={pickedRole}
              onChange={(e) => setPickedRole(e.target.value as RoleOnProject)}
              className={inputCls()}
              aria-label={t("members.role")}
            >
              {ROLE_ON_PROJECT_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{t(`role.${r.value}`)}</option>
              ))}
            </select>
          )}
          <button
            type="submit"
            disabled={!pickedUserId || allocate.isPending}
            className="text-xs rounded-md bg-indigo-600 text-white px-3 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {t("members.allocate")}
          </button>
        </form>
      )}
      {canEdit && mode === "page" && (
        <p className="text-xs text-(--color-muted)">
          {t("members.compensationHint")}
        </p>
      )}
      {canEdit && available.length === 0 && allocated.data && allocated.data.length > 0 && (
        <p className="text-xs text-(--color-muted)">{t("members.allAllocated")}</p>
      )}
    </div>
  );
}

function Row({
  userId, name, email, role, denied, rate,
  canEdit, mode, onUpdate, onUnallocate, busy,
}: {
  userId: string;
  name: string;
  email: string;
  role: RoleOnProject;
  denied: boolean;
  rate: number | null;
  canEdit: boolean;
  mode: "panel" | "page";
  onUpdate: (payload: { roleOnProject?: RoleOnProject; costPerHour?: number | null; denied?: boolean }) => Promise<void>;
  onUnallocate: () => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation();

  return (
    <li className={`px-3 py-2 text-xs flex items-center gap-2 ${denied ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <Link
          href={`/members/${userId}`}
          className="text-(--color-fg) hover:text-indigo-600 truncate block"
        >
          {name}
        </Link>
        <div className="text-(--color-muted) truncate">{email}</div>
      </div>

      {mode === "page" ? (
        <>
          <select
            value={role}
            disabled={!canEdit || busy}
            onChange={(e) => onUpdate({ roleOnProject: e.target.value as RoleOnProject })}
            className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1 text-xs disabled:opacity-50"
            aria-label={t("members.role")}
          >
            {ROLE_ON_PROJECT_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{t(`role.${r.value}`)}</option>
            ))}
          </select>
          <span
            className="text-xs text-(--color-muted) font-mono w-20 text-right"
            title={t("members.rateReadOnlyHint")}
          >
            {rate === null ? "—" : rate.toFixed(2)}
          </span>
          <label className="flex items-center gap-1 text-(--color-muted) cursor-pointer" title={t("members.deniedTitle")}>
            <input
              type="checkbox"
              checked={denied}
              disabled={!canEdit || busy}
              onChange={(e) => onUpdate({ denied: e.target.checked })}
            />
            {t("members.denied")}
          </label>
        </>
      ) : (
        <>
          <span className="text-xs text-(--color-muted) shrink-0">{t(`role.${role}`)}</span>
          {rate !== null && (
            <span className="text-xs text-(--color-muted) font-mono shrink-0">{rate.toFixed(2)}/h</span>
          )}
        </>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={onUnallocate}
          disabled={busy}
          className="text-rose-500 hover:text-rose-700 disabled:opacity-50 px-1"
          title={t("common.remove")}
        >
          ×
        </button>
      )}
    </li>
  );
}

function inputCls() {
  return "rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none disabled:opacity-50";
}

// axios error → localized message. The `t` function is passed in so the
// catalog hits the same locale as the surrounding component.
function axiosErr(err: unknown, t: (key: string, opts?: Record<string, unknown>) => string): string | null {
  if (axios.isAxiosError(err)) {
    const code = err.response?.data?.code;
    const msg = err.response?.data?.error;
    if (code === "last_manager") {
      return t("members.lastManager");
    }
    return msg ?? null;
  }
  return null;
}
