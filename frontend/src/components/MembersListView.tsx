"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useAddMember, useMembers } from "@/hooks/useMembers";
import { useOrg } from "@/hooks/useOrgs";
import type { MemberItem, OrgRole } from "@/lib/types";

const ROLES: OrgRole[] = ["viewer", "developer", "tech_lead", "manager", "admin", "owner"];

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1, developer: 2, tech_lead: 3, manager: 4, admin: 5, owner: 6,
};

function rolesBelow(actor: OrgRole | undefined): OrgRole[] {
  if (!actor) return [];
  return ROLES.filter((r) => ROLE_RANK[actor] > ROLE_RANK[r]);
}

// Directory at /members. Click a row to open /members/{userId}.
// Visibility:
//   - Listed for anyone with MembersRead (Viewer+) — the backend filter
//     is the real gate.
//   - Cost column rendered only when canSeeCost (Manager+).
// No pagination in v1: typical orgs <50 members. Client-side search by
// name/email is enough.
export function MembersListView() {
  const { t } = useTranslation();
  const { orgId } = useCurrentOrgId();
  const org = useOrg(orgId);
  const members = useMembers(orgId);
  const add = useAddMember(orgId);
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const yourRole = org.data?.yourRole;
  const isOwner = yourRole === "owner";
  const canSeeCost =
    yourRole === "owner" || yourRole === "admin" || yourRole === "manager";
  const canInvite = canSeeCost;
  const inviteRoleOptions = isOwner ? ROLES : rolesBelow(yourRole);

  const filtered = useMemo(() => {
    const list = members.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const name = (m.name || "").toLowerCase();
      const email = m.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [members.data, query]);

  if (!orgId) {
    return (
      <div className="p-6 text-sm text-(--color-muted)">
        {t("common.pickOrgFirst")}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-fg)">
            {t("members.title")}
          </h1>
          <p className="text-xs text-(--color-muted) mt-1">
            {t("members.count", { count: members.data?.length ?? 0 })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("members.search.placeholder")}
            className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {canInvite && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="text-xs rounded-md bg-indigo-600 text-white px-3 py-1.5 font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap"
            >
              {t("members.invite.cta")}
            </button>
          )}
        </div>
      </header>

      {canInvite && inviteOpen && (
        <InviteMemberModal
          onClose={() => setInviteOpen(false)}
          roleOptions={inviteRoleOptions}
          onSubmit={async (payload) => {
            await add.mutateAsync(payload);
            setInviteOpen(false);
          }}
          pending={add.isPending}
        />
      )}

      {members.isLoading && (
        <p className="text-sm text-(--color-muted)">{t("common.loading")}</p>
      )}

      {members.data && filtered.length === 0 && (
        <p className="text-sm text-(--color-muted)">{t("members.list.empty")}</p>
      )}

      {filtered.length > 0 && (
        <div className="rounded-2xl border border-(--color-border) bg-(--color-card) overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-(--color-muted) text-left bg-(--color-bg)">
              <tr>
                <th className="font-medium px-4 py-2">{t("members.column.name")}</th>
                <th className="font-medium px-4 py-2">{t("members.column.email")}</th>
                <th className="font-medium px-4 py-2">{t("members.column.role")}</th>
                <th className="font-medium px-4 py-2">{t("members.column.joined")}</th>
                {canSeeCost && (
                  <th className="font-medium px-4 py-2 text-right">
                    {t("members.column.rate")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <MemberRow
                  key={m.userId}
                  m={m}
                  canSeeCost={canSeeCost}
                  roleLabel={t(`members.role.${m.role}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MemberRow({
  m,
  canSeeCost,
  roleLabel,
}: {
  m: MemberItem;
  canSeeCost: boolean;
  roleLabel: string;
}) {
  const initial = (m.name || m.email)[0]?.toUpperCase() ?? "?";
  return (
    <tr className="border-t border-(--color-border) hover:bg-(--color-bg) transition-colors">
      <td className="px-4 py-2">
        <Link
          href={`/members/${m.userId}`}
          className="flex items-center gap-2 text-(--color-fg) hover:text-indigo-600"
        >
          <span className="h-8 w-8 rounded-full bg-(--color-bg) border border-(--color-border) inline-flex items-center justify-center text-xs font-semibold">
            {initial}
          </span>
          <span className="truncate">{m.name || m.email}</span>
        </Link>
      </td>
      <td className="px-4 py-2 text-(--color-muted) truncate">{m.email}</td>
      <td className="px-4 py-2">
        <RoleBadge role={m.role} label={roleLabel} />
      </td>
      <td className="px-4 py-2 text-(--color-muted) text-xs">
        {formatJoined(m.joinedAt)}
      </td>
      {canSeeCost && (
        <td className="px-4 py-2 text-right font-mono text-xs">
          {m.costPerHour === null ? "—" : `${m.costPerHour.toFixed(2)} /h`}
        </td>
      )}
    </tr>
  );
}

function RoleBadge({ role, label }: { role: OrgRole; label: string }) {
  const tone =
    role === "owner" || role === "admin"
      ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
      : role === "manager"
        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
        : role === "tech_lead"
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-(--color-bg) text-(--color-muted)";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {label}
    </span>
  );
}

function formatJoined(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

// Lightweight modal for inviting a member. Lifted out of the deleted
// SettingsMembersView. Uses the existing useAddMember mutation — the
// underlying endpoint is unchanged.
function InviteMemberModal({
  onClose,
  roleOptions,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  roleOptions: OrgRole[];
  onSubmit: (payload: { email: string; role: OrgRole }) => Promise<void>;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>(
    roleOptions[roleOptions.length - 1] ?? "viewer",
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), role });
    } catch (err) {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : null;
      setError(msg ?? t("members.allocateFailed"));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-(--color-fg)">
          {t("members.list.invite_modal_title")}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">
              {t("members.column.email")}
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">
              {t("members.column.role")}
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={pending}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{t(`members.role.${r}`)}</option>
              ))}
            </select>
          </label>
          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {pending ? t("common.saving") : t("members.allocate")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-1.5 text-xs font-medium hover:border-indigo-300 disabled:opacity-50 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
