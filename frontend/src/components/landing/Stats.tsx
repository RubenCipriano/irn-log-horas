"use client";

import { useTranslation } from "react-i18next";

// Marketing-only stat row. Mirrors the in-app Dashboard stat-card pattern
// (label / big number / hint) so the marketing surface and the product feel
// like one design.
export function StatsLanding() {
  const { t } = useTranslation();

  const cards = [
    {
      label: t("marketing.stats.card1Label"),
      value: t("marketing.stats.card1Value"),
      hint: t("marketing.stats.card1Hint"),
      // Plain foreground; first card stays calm.
      valueClass: "text-(--color-fg)",
    },
    {
      label: t("marketing.stats.card2Label"),
      value: t("marketing.stats.card2Value"),
      hint: t("marketing.stats.card2Hint"),
      // Indigo→violet gradient draws the eye to the headline metric.
      valueClass:
        "bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent",
    },
    {
      label: t("marketing.stats.card3Label"),
      value: t("marketing.stats.card3Value"),
      hint: t("marketing.stats.card3Hint"),
      // Emerald signals the positive outcome (hours recovered).
      valueClass: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <section
      aria-label={t("marketing.stats.sectionLabel")}
      className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-5xl mx-auto px-6 py-16 sm:py-20 tf-stagger"
    >
      {cards.map((card, i) => (
        <div
          key={i}
          className="tf-fade-up rounded-2xl border border-(--color-border) bg-(--color-card) p-6 flex flex-col gap-3"
          style={{ ["--tf-index" as string]: i }}
        >
          {/* Browser-frame mockup: three dots + faux URL bar, no real screenshots. */}
          <div className="rounded-lg border border-(--color-border) bg-(--color-bg) overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-(--color-border)">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full bg-red-400"
              />
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full bg-yellow-400"
              />
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full bg-emerald-400"
              />
              <div className="ml-2 flex-1 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted) truncate">
                {t("marketing.stats.mockUrl")}
              </div>
            </div>
            <div className="px-4 py-5 flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
                {card.label}
              </span>
              <span
                className={`text-4xl font-bold tabular-nums leading-none ${card.valueClass}`}
              >
                {card.value}
              </span>
              <span className="text-xs text-(--color-muted) leading-relaxed">
                {card.hint}
              </span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
