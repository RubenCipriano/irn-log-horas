"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Post-signup landing — Phase 3 wires /api/orgs (create). Until then the
// form just records the user's choice client-side and bounces to
// /dashboard so the rest of the shell stays explorable.

type CreateOrgError = { error: string } | null;

export default function CreateOrgPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CreateOrgError>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/orgs", { name });
      qc.removeQueries({ queryKey: ["auth"] });
      router.push("/dashboard");
    } catch (err) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Org creation isn't wired yet — Phase 5 lands /api/orgs.";
      setError({ error: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-6 tf-fade-up">
        <header className="text-center space-y-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-11 w-11 rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white text-sm font-bold shadow-md shadow-indigo-500/30"
          >
            TF
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-(--color-fg)">
            Create your first org
          </h1>
          <p className="text-sm text-(--color-muted)">
            One TimeFlow workspace can host multiple client orgs. You&apos;re the
            Owner of the one you create here.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-2xl border border-(--color-border) bg-(--color-card) p-5 shadow-sm"
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Org name</span>
            <input
              type="text"
              required
              minLength={2}
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder="Acme Inc."
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-200 disabled:opacity-60"
            />
          </label>

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-200 border border-rose-200 dark:border-rose-900/50 rounded px-3 py-2">
              {error.error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 text-white px-3 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm shadow-indigo-500/30"
          >
            {busy ? "Creating…" : "Create org"}
          </button>
        </form>

        <p className="text-center text-xs text-(--color-muted)">
          <Link href="/login" className="text-indigo-600 hover:underline">
            ← Sign in instead
          </Link>
        </p>
      </div>
    </main>
  );
}
