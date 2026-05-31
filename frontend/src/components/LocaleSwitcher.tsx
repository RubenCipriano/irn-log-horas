"use client";

import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n/locale-cookie";

// Three-segment switcher styled after ThemeToggle so the topbar feels
// like one control row. Clicking a segment calls i18n.changeLanguage —
// the browser-languagedetector module then persists the choice to both
// cookie and localStorage on its own (see config.ts → detection.caches).

const SEGMENTS: { code: SupportedLocale; label: string; title: string }[] = [
  { code: "pt", label: "PT", title: "Português" },
  { code: "en", label: "EN", title: "English" },
  { code: "fr", label: "FR", title: "Français" },
];

export function LocaleSwitcher() {
  const { i18n, t } = useTranslation();
  const active = (i18n.resolvedLanguage ?? "en") as SupportedLocale;
  return (
    <div
      role="radiogroup"
      aria-label={t("locale.switcher.label", "Language")}
      className="inline-flex items-center rounded-full border border-(--color-border) bg-(--color-card) p-0.5 text-[11px] font-medium"
    >
      {SEGMENTS.map((s) => {
        const isActive = active === s.code;
        return (
          <button
            key={s.code}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={s.title}
            onClick={() => i18n.changeLanguage(s.code)}
            className={
              isActive
                ? "rounded-full bg-indigo-600 text-white px-2.5 py-0.5"
                : "rounded-full text-(--color-muted) hover:text-(--color-fg) px-2.5 py-0.5"
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
