"use client";

import { useTranslation } from "react-i18next";

const STEP_KEYS = ["step1", "step2", "step3"] as const;

function ConnectionChips({ t }: { t: (key: string) => string }) {
  const chips = [
    { label: "OPENPROJECT", active: true },
    { label: "JIRA", active: false },
    { label: "GITLAB", active: false },
  ];
  return (
    <div
      className="mt-5 flex flex-wrap gap-2"
      aria-label={t("marketing.howItWorks.step1Mockup")}
    >
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="inline-flex items-center gap-1.5 rounded-md border border-(--color-border) bg-(--color-bg) px-2 py-1 text-[10px] uppercase tracking-wider text-(--color-muted)"
        >
          {chip.active ? (
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden
            />
          ) : (
            <span
              className="h-1.5 w-1.5 rounded-full bg-(--color-border)"
              aria-hidden
            />
          )}
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function DescribeInput({ t }: { t: (key: string) => string }) {
  return (
    <div
      className="mt-5 flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-bg) p-2"
      aria-label={t("marketing.howItWorks.step2Mockup")}
    >
      <span className="flex-1 truncate text-[11px] text-(--color-muted)">
        {t("marketing.howItWorks.step2Placeholder")}
      </span>
      <span className="text-sm text-indigo-500" aria-hidden>
        ✨
      </span>
    </div>
  );
}

function CalendarStrip({ t }: { t: (key: string) => string }) {
  const cells = [
    { hours: "6h", tone: "emerald" },
    { hours: "8h", tone: "emerald" },
    { hours: "5h", tone: "amber" },
    { hours: "7h", tone: "indigo" },
    { hours: "4h", tone: "amber" },
  ];
  return (
    <div
      className="mt-5 grid grid-cols-5 gap-1"
      aria-label={t("marketing.howItWorks.step3Mockup")}
    >
      {cells.map((cell, idx) => {
        const base =
          "rounded-md border px-1 py-2 text-center text-[9px] font-medium";
        const toneClass =
          cell.tone === "emerald"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
            : cell.tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
              : "border-indigo-300 bg-(--color-bg) text-indigo-600 ring-2 ring-indigo-500 dark:text-indigo-300";
        return (
          <div key={idx} className={`${base} ${toneClass}`}>
            {cell.hours} / 8h
          </div>
        );
      })}
    </div>
  );
}

function StepMockup({
  step,
  t,
}: {
  step: (typeof STEP_KEYS)[number];
  t: (key: string) => string;
}) {
  if (step === "step1") return <ConnectionChips t={t} />;
  if (step === "step2") return <DescribeInput t={t} />;
  return <CalendarStrip t={t} />;
}

export function HowItWorksLanding() {
  const { t } = useTranslation();

  return (
    <section
      id="how-it-works"
      className="bg-(--color-bg)"
      aria-labelledby="how-it-works-heading"
    >
      <div className="max-w-5xl mx-auto px-6 py-20 sm:py-24">
        <header className="mb-12 text-center tf-fade-up">
          <p className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
            {t("marketing.howItWorks.eyebrow")}
          </p>
          <h2
            id="how-it-works-heading"
            className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)"
          >
            {t("marketing.howItWorks.heading")}
          </h2>
        </header>

        <div
          className="rounded-2xl border border-(--color-border) bg-(--color-card) shadow-sm overflow-hidden"
          aria-label={t("marketing.howItWorks.frameLabel")}
        >
          <div className="flex items-center gap-2 border-b border-(--color-border) bg-(--color-bg) px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
            <span className="ml-3 flex-1 max-w-xs rounded-md border border-(--color-border) bg-(--color-card) px-2 py-0.5 text-[10px] text-(--color-muted) truncate">
              {t("marketing.howItWorks.frameUrl")}
            </span>
          </div>
          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 tf-stagger"
            style={{ ["--tf-stagger-step" as string]: "120ms" }}
          >
            {STEP_KEYS.map((step, idx) => (
              <article
                key={step}
                className="tf-fade-up rounded-2xl border border-(--color-border) bg-(--color-bg) p-6 flex flex-col"
                style={{ ["--tf-index" as string]: idx }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm"
                    aria-hidden
                  >
                    {idx + 1}
                  </span>
                  <h3 className="text-base font-semibold text-(--color-fg)">
                    {t(`marketing.howItWorks.${step}Title`)}
                  </h3>
                </div>
                <p className="mt-3 text-sm sm:text-base text-(--color-muted) leading-relaxed">
                  {t(`marketing.howItWorks.${step}Body`)}
                </p>
                <div className="mt-auto">
                  <StepMockup step={step} t={t} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
