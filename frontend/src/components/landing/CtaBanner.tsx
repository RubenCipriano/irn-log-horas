"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function CtaBannerLanding() {
  const { t } = useTranslation();

  return (
    <section className="max-w-5xl mx-auto px-6 pb-24">
      <div className="relative overflow-hidden rounded-3xl border border-(--color-border) bg-(--color-card) px-8 py-16 sm:px-16 sm:py-20 text-center">
        {/* Soft indigo/violet glow echoing the Hero recipe. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(ellipse at top, rgba(99,102,241,0.35), transparent 60%), radial-gradient(ellipse at 30% 20%, rgba(168,85,247,0.25), transparent 60%)",
          }}
        />

        <div className="flex flex-col items-center gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-bg) px-3 py-1 text-xs font-medium text-(--color-muted)">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            {t("marketing.ctaBanner.badge")}
          </span>

          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg) leading-tight max-w-3xl">
            {t("marketing.ctaBanner.headingPrefix")}{" "}
            <span className="bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
              {t("marketing.ctaBanner.headingAccent")}
            </span>
          </h2>

          <p className="text-sm sm:text-base text-(--color-muted) leading-relaxed max-w-2xl">
            {t("marketing.ctaBanner.sub")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link
              href="/signup"
              className="rounded-lg bg-indigo-600 px-6 py-3 text-white font-medium hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5"
            >
              {t("marketing.ctaBanner.primary")}
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-(--color-border) bg-(--color-card) px-6 py-3 font-medium text-(--color-fg) hover:border-indigo-300 transition-all"
            >
              {t("marketing.ctaBanner.secondary")}
            </Link>
          </div>

          <p className="text-xs text-(--color-muted) pt-2">
            {t("marketing.ctaBanner.finePrint")}
          </p>
        </div>
      </div>
    </section>
  );
}
