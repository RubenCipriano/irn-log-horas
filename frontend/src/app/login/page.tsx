"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Static shell (build emits /out/login/index.html). The form submits in
// the browser via the configured `api` client → POST /api/auth/login on
// the .NET backend (backend route lands in Phase 3). The cookie is
// HTTP-only and goes back via Set-Cookie on success.

type LoginError = { error: string } | null;

export default function LoginPage() {
  // useSearchParams forces a CSR bailout — Suspense boundary required
  // when output: 'export'. The fallback never actually paints since the
  // SSG render goes through it synchronously on the client.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginError>(null);

  // `?next=/some/path` — set by the authed shell when it bounces an
  // unauthenticated user to /login. Falls back to /dashboard.
  const nextRaw = search?.get("next") ?? "/dashboard";
  const next = nextRaw.startsWith("/") ? nextRaw : "/dashboard";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      qc.removeQueries({ queryKey: ["auth"] });
      router.push(next);
    } catch (err) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : "Login is not wired yet — Phase 3 lands the backend route.";
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
            Welcome back
          </h1>
          <p className="text-sm text-(--color-muted)">Sign in to TimeFlow.</p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-3 rounded-2xl border border-(--color-border) bg-(--color-card) p-5 shadow-sm"
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) text-(--color-fg) px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-200 disabled:opacity-60"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-(--color-fg)">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
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
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-(--color-muted)">
          New here?{" "}
          <Link href="/signup" className="text-indigo-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
