"use client";

import { useState } from "react";
import axios from "axios";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentOrgId } from "@/hooks/useCurrentOrgId";
import { useDeleteOrg, useMyOrgs, useOrg } from "@/hooks/useOrgs";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SettingsNav } from "@/components/SettingsNav";

// Minimal account-settings surface: change password + view 2FA status.
// Full 2FA enroll/disable flow has its own dedicated screen later — the
// account page just surfaces the state and a "go to security" link.
export function SettingsAccountView() {
  const auth = useAuth();
  const { orgId } = useCurrentOrgId();
  const org = useOrg(orgId);
  const orgs = useMyOrgs();
  const deleteOrg = useDeleteOrg(orgId);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Org delete state — owner-only "danger zone".
  const isOwner = org.data?.yourRole === "owner";
  const [confirmName, setConfirmName] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function onDeleteOrg(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    try {
      await deleteOrg.mutateAsync({ confirmName, password: deletePassword });
      // Pick another org to land on, else send to onboarding.
      const remaining = (orgs.data ?? []).filter((o) => o.id !== orgId);
      const nextOrgId = remaining[0]?.id ?? null;
      try {
        if (nextOrgId) localStorage.setItem("tf_current_org", nextOrgId);
        else localStorage.removeItem("tf_current_org");
      } catch { /* ignore */ }
      window.location.href = nextOrgId ? "/dashboard" : "/onboarding/create-org";
    } catch (err) {
      setDeleteError(
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Delete failed.",
      );
    }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api.post("/api/account/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setStatus({ ok: true, msg: "Password updated." });
      setCurrent("");
      setNext("");
    } catch (err) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Password change failed.";
      setStatus({ ok: false, msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <SettingsNav />
      <header className="space-y-1 tf-fade-up max-w-xl">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">Account</p>
        <h2 className="text-2xl font-bold text-(--color-fg)">
          {auth.user?.email ?? "Loading…"}
        </h2>
      </header>

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3 tf-fade-up max-w-xl">
        <h3 className="text-sm font-semibold text-(--color-fg)">Preferences</h3>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-(--color-muted)">Language</span>
          <LocaleSwitcher />
        </div>
      </section>

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-3 tf-fade-up max-w-xl">
        <h3 className="text-sm font-semibold text-(--color-fg)">Change password</h3>
        <form onSubmit={onChangePassword} className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Current password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">New password</span>
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={busy}
              className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            <p className="text-[11px] text-(--color-muted)">12 characters min.</p>
          </label>

          {status && (
            <p
              className={
                "text-xs rounded px-2 py-1 " +
                (status.ok
                  ? "text-emerald-700 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/20"
                  : "text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/20")
              }
            >
              {status.msg}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-(--color-border) bg-(--color-card) p-5 space-y-2 tf-fade-up max-w-xl">
        <h3 className="text-sm font-semibold text-(--color-fg)">Two-factor authentication</h3>
        <p className="text-sm text-(--color-muted)">
          {auth.user?.twoFactorEnabled
            ? "Enabled — codes are required on sign-in."
            : "Not enabled. Configure on the dedicated security screen (coming soon)."}
        </p>
      </section>

      {isOwner && (
        <section className="rounded-2xl border border-rose-300 dark:border-rose-700 bg-rose-50/40 dark:bg-rose-900/10 p-5 space-y-3 tf-fade-up max-w-xl">
          <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Danger zone</h3>
          <p className="text-xs text-(--color-muted)">
            Deleting <span className="font-semibold text-(--color-fg)">{org.data?.name ?? "this org"}</span>{" "}
            permanently removes its projects, tasks, members, integrations, clients, and invoices.
            This cannot be undone.
          </p>
          {!deleteOpen ? (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="text-xs rounded-md border border-rose-300 text-rose-700 dark:text-rose-300 px-3 py-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/30"
            >
              Delete org…
            </button>
          ) : (
            <form onSubmit={onDeleteOrg} className="space-y-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">
                  Type the org name to confirm: <span className="font-mono">{org.data?.name}</span>
                </span>
                <input
                  type="text"
                  required
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  disabled={deleteOrg.isPending}
                  className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-rose-500 focus:outline-none disabled:opacity-50"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-(--color-fg)">Your password</span>
                <input
                  type="password"
                  required
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  disabled={deleteOrg.isPending}
                  autoComplete="current-password"
                  className="w-full rounded-md border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-2 py-1.5 text-sm focus:border-rose-500 focus:outline-none disabled:opacity-50"
                />
              </label>
              {deleteError && (
                <p className="text-xs text-rose-700 dark:text-rose-200 bg-rose-100 dark:bg-rose-900/20 rounded px-2 py-1">
                  {deleteError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setDeleteOpen(false); setConfirmName(""); setDeletePassword(""); setDeleteError(null); }}
                  disabled={deleteOrg.isPending}
                  className="text-xs text-(--color-muted) px-2 py-1 hover:text-(--color-fg)"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleteOrg.isPending || confirmName !== org.data?.name || !deletePassword}
                  className="text-xs rounded-md bg-rose-600 text-white px-3 py-1.5 font-medium hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleteOrg.isPending ? "Deleting…" : "Permanently delete org"}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
