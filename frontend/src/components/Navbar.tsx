"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Navbar() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 backdrop-blur supports-backdrop-filter:bg-[color-mix(in_oklch,var(--color-bg)_85%,transparent)] border-b border-(--color-border)">
      <div className="px-6 py-4 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white text-sm font-bold shadow-sm shadow-indigo-500/30">
            TF
          </div>
          <span className="font-semibold text-(--color-fg)">{t("marketing.navbar.brand")}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/about" className="text-(--color-muted) hover:text-(--color-fg) px-3 py-1.5 rounded-md transition-colors">
            {t("marketing.navbar.about")}
          </Link>
          <Link href="/policy" className="text-(--color-muted) hover:text-(--color-fg) px-3 py-1.5 rounded-md transition-colors">
            {t("marketing.navbar.privacy")}
          </Link>
          <Link href="/login" className="text-(--color-muted) hover:text-(--color-fg) px-3 py-1.5 rounded-md transition-colors">
            {t("marketing.navbar.signIn")}
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 font-medium hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-500/30"
          >
            {t("marketing.navbar.startTrial")}
          </Link>
          <span className="ml-2 pl-2 border-l border-(--color-border)">
            <ThemeToggle />
          </span>
        </nav>
      </div>
    </header>
  );
}
