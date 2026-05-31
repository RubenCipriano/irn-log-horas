"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE,
  SUPPORTED_LOCALES,
} from "./locale-cookie";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// One-time i18next bootstrap. Runs on the client only (the SPA is static-
// exported, so there's no SSR locale resolution to coordinate with).
//
// Detection chain on first paint:
//   1. localStorage  (LOCALE_STORAGE key)  — survives a cookie wipe
//   2. cookie        (LOCALE_COOKIE key)   — survives a localStorage wipe
//   3. navigator.language                  — first-visit auto-detect
//   4. DEFAULT_LOCALE                      — project default (PT)
//
// After init, `i18n.changeLanguage(next)` is the only path to switch. The
// detector module persists to BOTH cookie and localStorage on every
// change so the two stores stay in sync without us writing custom code.
//
// `returnNull: false` means a missing key falls back to the keyName so
// untranslated strings stay visible in development — easier to spot than
// a silent blank.
let initialised = false;

export function initI18n(): typeof i18n {
  if (initialised) return i18n;
  initialised = true;
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        pt: { translation: pt as Record<string, string> },
        en: { translation: en as Record<string, string> },
        fr: { translation: fr as Record<string, string> },
      },
      supportedLngs: SUPPORTED_LOCALES,
      fallbackLng: DEFAULT_LOCALE,
      // Flat keys (e.g. "project.detail.name") — i18next's nested-key
      // separator would consume the dots and look for { project: { detail
      // : { name: ... } } }. Disable both nesting separators so we can use
      // dotted keys directly.
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false }, // React already escapes
      detection: {
        order: ["localStorage", "cookie", "navigator"],
        lookupLocalStorage: LOCALE_STORAGE,
        lookupCookie: LOCALE_COOKIE,
        caches: ["localStorage", "cookie"],
        cookieMinutes: 60 * 24 * 365, // 1 year
        cookieOptions: { path: "/", sameSite: "lax" },
      },
      returnNull: false,
      // Whatever language detector picks, snap it to the closest base code
      // ("pt-BR" → "pt") so regional variants share the catalog.
      load: "languageOnly",
    });
  return i18n;
}

export { i18n };
