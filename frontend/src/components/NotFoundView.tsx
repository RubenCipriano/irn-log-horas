"use client";

import Link from "next/link";

export function NotFoundView({ path }: { path: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 text-center min-h-[60vh]">
      <div className="max-w-md space-y-3 tf-fade-up">
        <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">404</p>
        <h2 className="text-2xl font-bold text-(--color-fg)">Route not found</h2>
        <p className="text-sm text-(--color-muted)">
          <code className="rounded bg-(--color-card) border border-(--color-border) px-1 py-0.5 text-(--color-fg)">{path}</code>{" "}
          doesn&apos;t map to anything in this build.
        </p>
        <Link href="/dashboard" className="inline-block text-sm text-indigo-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
