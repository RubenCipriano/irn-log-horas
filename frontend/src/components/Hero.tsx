"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden px-6 pt-24 pb-32 sm:pt-32 sm:pb-40">
      {/* Decorative glow behind the headline. Pure CSS, no images. */}
      <div
        aria-hidden
        className="absolute inset-x-0 -top-32 h-[520px] -z-10 opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(99,102,241,0.35), transparent 60%), radial-gradient(ellipse at 30% 20%, rgba(168,85,247,0.25), transparent 60%)",
        }}
      />
      <div className="max-w-3xl mx-auto text-center space-y-7 tf-fade-up">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-linear-to-br from-indigo-500 to-violet-500 text-white text-3xl font-bold mx-auto shadow-xl shadow-indigo-500/30 tf-pulse-glow">
          TF
        </div>
        <div className="space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-(--color-border) bg-(--color-card) px-3 py-1 text-xs font-medium text-(--color-muted)">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("marketing.hero.badge")}
          </span>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-(--color-fg) leading-[1.05]">
            {t("marketing.hero.headingPrefix")}{" "}
            <span className="bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
              {t("marketing.hero.headingAccent")}
            </span>
          </h1>
        </div>
        <p className="text-lg text-(--color-muted) max-w-xl mx-auto leading-relaxed">
          {t("marketing.hero.sub")}
        </p>
        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-white font-medium hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5"
          >
            {t("marketing.hero.primary")}
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-(--color-border) bg-(--color-card) px-6 py-3 font-medium text-(--color-fg) hover:border-indigo-300 transition-all"
          >
            {t("marketing.hero.secondary")}
          </Link>
        </div>
        <p className="text-xs text-(--color-muted) pt-2">
          {t("marketing.hero.finePrint")}
        </p>
      </div>
    </section>
  );
}
