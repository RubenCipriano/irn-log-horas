"use client";

import { useEffect, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { initI18n } from "@/lib/i18n/config";

// Wraps the SPA in i18next's React provider after a one-shot init. The
// init has to run on the client (static export = no SSR), so we render
// children only after initialise resolves — otherwise components that
// call useTranslation during the first render get an i18next instance
// without resources loaded and key lookups return raw key names instead
// of the source PT strings.
//
// The init is synchronous (resources are imported at build time, no
// network fetch), so the "before ready" window is microseconds — we
// still gate via a tiny useEffect/useState to avoid hydration mismatch
// between server-rendered HTML and client.

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [i18nInstance, setI18nInstance] = useState<ReturnType<typeof initI18n> | null>(null);

  useEffect(() => {
    const inst = initI18n();
    setI18nInstance(inst);
    const syncLang = () => {
      const next = inst.resolvedLanguage ?? inst.language;
      if (next && typeof document !== "undefined") {
        document.documentElement.lang = next;
      }
    };
    syncLang();
    inst.on("languageChanged", syncLang);
    return () => {
      inst.off("languageChanged", syncLang);
    };
  }, []);

  // Pre-init: render children without a provider. useTranslation in
  // children will return raw key names briefly (one paint at most). Once
  // the instance is ready we re-render under the provider with the right
  // catalog. For a static-export SPA this brief window is acceptable.
  if (!i18nInstance) return <>{children}</>;
  return <I18nextProvider i18n={i18nInstance}>{children}</I18nextProvider>;
}
