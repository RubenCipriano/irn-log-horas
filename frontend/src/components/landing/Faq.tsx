"use client";

import { useTranslation } from "react-i18next";

const ITEM_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-(--color-border) bg-(--color-card) overflow-hidden shadow-sm">
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-(--color-border) bg-(--color-bg)/60">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
        <span
          className="ml-3 h-3 flex-1 max-w-xs rounded-full bg-(--color-border)/60"
          aria-hidden
        />
      </div>
      {children}
    </div>
  );
}

export function FaqLanding() {
  const { t } = useTranslation();

  return (
    <section id="faq">
      <div className="max-w-3xl mx-auto px-6 py-20 sm:py-24 tf-fade-up">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
            {t("marketing.faq.eyebrow")}
          </p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
            {t("marketing.faq.heading")}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-(--color-muted) leading-relaxed">
            {t("marketing.faq.sub")}
          </p>
        </header>

        <div className="mt-12">
          <BrowserFrame>
            <div className="divide-y divide-(--color-border)">
              {ITEM_KEYS.map((k, idx) => (
                <details
                  key={k}
                  className="group open:bg-(--color-bg)/40 transition-colors"
                  open={idx === 0}
                >
                  <summary className="px-6 py-5 flex items-center justify-between cursor-pointer text-base font-medium text-(--color-fg) list-none [&::-webkit-details-marker]:hidden">
                    <span>{t(`marketing.faq.${k}`)}</span>
                    <span
                      className="ml-4 h-2 w-2 border-r-2 border-b-2 border-(--color-muted) rotate-45 transition-transform group-open:rotate-[225deg]"
                      aria-hidden
                    />
                  </summary>
                  <div className="px-6 pb-5 text-sm text-(--color-muted) leading-relaxed">
                    {t(`marketing.faq.a${k.slice(1)}`)}
                  </div>
                </details>
              ))}
            </div>
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
