"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="px-6 py-8 text-center text-xs text-(--color-muted) border-t border-(--color-border) mt-auto">
      <div className="flex items-center justify-center gap-4 max-w-6xl mx-auto">
        <span>{t("marketing.footer.copyright")}</span>
        <Link href="/about" className="hover:text-(--color-fg) transition-colors">{t("marketing.footer.about")}</Link>
        <Link href="/policy" className="hover:text-(--color-fg) transition-colors">{t("marketing.footer.privacy")}</Link>
      </div>
    </footer>
  );
}
