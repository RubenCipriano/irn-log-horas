"use client";

// Cookie + localStorage shape for the user's selected locale.
// Matches Next.js's NEXT_LOCALE convention so any future migration to
// server-side detection (per-locale build dirs, middleware, etc.) doesn't
// need to re-key the persistence layer.

export type SupportedLocale = "pt" | "en" | "fr";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["pt", "en", "fr"];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_STORAGE = "tf_locale";

/** Narrow an arbitrary string to a supported locale; null when unrecognised. */
export function normaliseLocale(raw: string | null | undefined): SupportedLocale | null {
  if (!raw) return null;
  const head = raw.toLowerCase().split("-")[0] as SupportedLocale;
  return (SUPPORTED_LOCALES as string[]).includes(head) ? head : null;
}

/** Read the persisted locale. Used by the inline boot script equivalent
 * and by the i18next detector module. Server-safe — returns null when
 * `document` is undefined (build / SSR). */
export function readPersistedLocale(): SupportedLocale | null {
  if (typeof document === "undefined") return null;
  // localStorage wins over cookie because it survives clearing third-party
  // cookies on browsers in strict mode; the cookie is the failsafe.
  try {
    const ls = localStorage.getItem(LOCALE_STORAGE);
    const fromLs = normaliseLocale(ls);
    if (fromLs) return fromLs;
  } catch {
    // localStorage blocked in private browsing — fall through to cookie.
  }
  const cookie = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
  return cookie ? normaliseLocale(decodeURIComponent(cookie.split("=")[1])) : null;
}

/** Persist the locale to BOTH cookie and localStorage so subsequent visits
 * pick it up regardless of which storage the browser has cleared. */
export function writePersistedLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  try {
    localStorage.setItem(LOCALE_STORAGE, locale);
  } catch {
    // Private browsing — cookie alone is enough for the session.
  }
  // 1-year cookie; SameSite=Lax matches the auth cookie's policy and lets
  // it ride along on top-level GET navigation from external referrers.
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; SameSite=Lax`;
}
