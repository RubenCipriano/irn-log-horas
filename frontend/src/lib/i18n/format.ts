"use client";

import { useTranslation } from "react-i18next";

// Thin Intl wrappers that pull the active locale from i18next at render
// time. Components reach for these instead of new `Intl.DateTimeFormat`
// directly so a single locale change in the LocaleSwitcher updates every
// formatted value across the tree.
//
// Pure functions (no React state) — safe to call inside render bodies.

export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  return {
    /** YYYY-MM-DD → localized date. */
    formatDate(value: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
      if (value == null) return "";
      const d = typeof value === "string" ? new Date(value) : value;
      if (Number.isNaN(d.getTime())) return String(value);
      return new Intl.DateTimeFormat(locale, opts ?? { year: "numeric", month: "short", day: "2-digit" }).format(d);
    },
    /** Number → localized number string with up to N decimals. */
    formatNumber(value: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
      if (value == null) return "";
      return new Intl.NumberFormat(locale, opts).format(value);
    },
    /** Number + ISO currency code → localized currency string. */
    formatCurrency(value: number | null | undefined, currency = "EUR"): string {
      if (value == null) return "";
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
    },
    locale,
  };
}
