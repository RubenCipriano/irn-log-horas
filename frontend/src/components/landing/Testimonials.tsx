"use client";

import { useTranslation } from "react-i18next";

type TestimonialSpec = {
  quoteKey: string;
  nameKey: string;
  initialsKey: string;
  roleKey: string;
};

// Marketing-only social-proof block. Synthetic personas covering the two
// clearest buyer profiles (solo consultant + small-agency owner), wrapped in
// the same browser-frame chrome the other landing sections use so the surface
// reads as one design.
export function TestimonialsLanding() {
  const { t } = useTranslation();

  const testimonials: TestimonialSpec[] = [
    {
      quoteKey: "marketing.testimonials.quote1",
      nameKey: "marketing.testimonials.author1Name",
      initialsKey: "marketing.testimonials.author1Initials",
      roleKey: "marketing.testimonials.author1Role",
    },
    {
      quoteKey: "marketing.testimonials.quote2",
      nameKey: "marketing.testimonials.author2Name",
      initialsKey: "marketing.testimonials.author2Initials",
      roleKey: "marketing.testimonials.author2Role",
    },
    {
      quoteKey: "marketing.testimonials.quote3",
      nameKey: "marketing.testimonials.author3Name",
      initialsKey: "marketing.testimonials.author3Initials",
      roleKey: "marketing.testimonials.author3Role",
    },
  ];

  return (
    <section aria-label={t("marketing.testimonials.sectionLabel")}>
      {/* Heading band, centred above the cards. */}
      <div className="max-w-5xl mx-auto px-6 pt-20 sm:pt-24 text-center flex flex-col gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
          {t("marketing.testimonials.eyebrow")}
        </span>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
          {t("marketing.testimonials.heading")}
        </h2>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-20 sm:py-24 grid grid-cols-1 md:grid-cols-2 gap-6 tf-stagger">
        {testimonials.map((entry, i) => (
          <article
            key={entry.quoteKey}
            className="tf-fade-up rounded-2xl border border-(--color-border) bg-(--color-card) p-7 flex flex-col"
            style={{ ["--tf-index" as string]: i }}
          >
            {/* Browser-frame mockup: three dots + faux URL bar, no real screenshots. */}
            <div className="rounded-lg border border-(--color-border) bg-(--color-bg) overflow-hidden mb-6">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-(--color-border)">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="ml-2 flex-1 rounded-md bg-(--color-card) border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted) truncate">
                  {t("marketing.testimonials.mockUrl")}
                </div>
              </div>
              <div className="px-4 py-4 flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full bg-emerald-500"
                />
                <span className="text-[11px] font-medium text-(--color-muted) uppercase tracking-wider">
                  {t("marketing.testimonials.mockBadge")}
                </span>
              </div>
            </div>

            {/* Large quote glyph opens the card. */}
            <span
              aria-hidden
              className="text-4xl text-indigo-600/40 leading-none font-serif"
            >
              &ldquo;
            </span>

            <blockquote className="text-base text-(--color-fg) leading-relaxed mt-1">
              {t(entry.quoteKey)}
            </blockquote>

            {/* Author row, separated by a thin top border. */}
            <div className="border-t border-(--color-border) mt-6 pt-4 flex items-center gap-3">
              <span
                aria-hidden
                className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center"
              >
                {t(entry.initialsKey)}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-(--color-fg)">
                  {t(entry.nameKey)}
                </span>
                <span className="text-xs text-(--color-muted)">
                  {t(entry.roleKey)}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
