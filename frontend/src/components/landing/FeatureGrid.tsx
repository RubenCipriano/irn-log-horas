"use client";

import { useTranslation } from "react-i18next";

type CardKey = "card1" | "card2" | "card3" | "card4" | "card5" | "card6";

type CardSpec = {
  key: CardKey;
  titleKey: string;
  bodyKey: string;
  mockup: React.ReactNode;
};

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-(--color-border)">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden />
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
        <span className="ml-2 h-1.5 flex-1 rounded-full bg-(--color-border)/60" aria-hidden />
      </div>
      <div className="p-2 h-14 flex items-center">{children}</div>
    </div>
  );
}

function MockupCalendar() {
  // Card1: 4x3 grid; 3 emerald, 1 amber, 1 rose, rest plain
  const cells: string[] = [
    "bg-emerald-50 dark:bg-emerald-500/20",
    "",
    "bg-amber-50 dark:bg-amber-500/20",
    "",
    "bg-emerald-50 dark:bg-emerald-500/20",
    "bg-rose-50 dark:bg-rose-500/20",
    "",
    "bg-emerald-50 dark:bg-emerald-500/20",
    "",
    "",
    "",
    "",
  ];
  return (
    <div className="grid grid-cols-4 gap-1 w-full">
      {cells.map((c, i) => (
        <span
          key={i}
          className={`h-2.5 rounded-[3px] border border-(--color-border) ${c || "bg-(--color-card)"}`}
          aria-hidden
        />
      ))}
    </div>
  );
}

function MockupAI() {
  // Card2: two lines + dot row
  return (
    <div className="w-full space-y-1.5">
      <span className="block h-1 rounded bg-(--color-border)" aria-hidden />
      <span className="block h-1 w-2/3 rounded bg-(--color-border)" aria-hidden />
      <div className="flex gap-1 pt-1" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="h-1 w-1 rounded-full bg-indigo-600" />
        ))}
      </div>
    </div>
  );
}

function MockupApproval() {
  // Card3: three avatars + emerald check
  return (
    <div className="flex items-center gap-1.5 w-full">
      <span className="h-3 w-3 rounded-full bg-indigo-100 dark:bg-indigo-500/30" aria-hidden />
      <span className="h-3 w-3 rounded-full bg-indigo-100 dark:bg-indigo-500/30" aria-hidden />
      <span className="h-3 w-3 rounded-full bg-indigo-100 dark:bg-indigo-500/30" aria-hidden />
      <span className="ml-auto text-emerald-500 text-xs leading-none font-bold" aria-hidden>
        &#10003;
      </span>
    </div>
  );
}

function MockupBilling() {
  // Card4: three slabs, last in indigo-600 with € label
  return (
    <div className="w-full space-y-1">
      <span className="block h-2 w-full rounded bg-(--color-border)" aria-hidden />
      <span className="block h-2 w-4/5 rounded bg-(--color-border)" aria-hidden />
      <span
        className="flex h-2 w-3/5 items-center justify-end rounded bg-indigo-600 px-1 text-[7px] leading-none font-semibold tabular-nums text-white"
        aria-hidden
      >
        &euro;
      </span>
    </div>
  );
}

function MockupTenant() {
  // Card5: three nested rounded boxes
  return (
    <div className="w-full flex items-center justify-center">
      <div className="rounded-md border border-(--color-border) p-1">
        <div className="rounded-md border border-(--color-border) p-1">
          <div className="rounded-md border border-(--color-border) px-2 py-0.5">
            <span className="block h-1 w-4 rounded bg-indigo-600" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}

function MockupLock() {
  // Card6: lock shape from divs (shackle + body)
  return (
    <div className="w-full flex items-center justify-center">
      <div className="flex flex-col items-center">
        <span className="h-2 w-3 rounded-t-full border-t-2 border-x-2 border-indigo-600" aria-hidden />
        <span className="h-3 w-5 rounded-md bg-indigo-600/90 -mt-px" aria-hidden />
      </div>
    </div>
  );
}

export function FeatureGridLanding() {
  const { t } = useTranslation();

  const cards: CardSpec[] = [
    {
      key: "card1",
      titleKey: "marketing.featureGrid.card1Title",
      bodyKey: "marketing.featureGrid.card1Body",
      mockup: <MockupCalendar />,
    },
    {
      key: "card2",
      titleKey: "marketing.featureGrid.card2Title",
      bodyKey: "marketing.featureGrid.card2Body",
      mockup: <MockupAI />,
    },
    {
      key: "card3",
      titleKey: "marketing.featureGrid.card3Title",
      bodyKey: "marketing.featureGrid.card3Body",
      mockup: <MockupApproval />,
    },
    {
      key: "card4",
      titleKey: "marketing.featureGrid.card4Title",
      bodyKey: "marketing.featureGrid.card4Body",
      mockup: <MockupBilling />,
    },
    {
      key: "card5",
      titleKey: "marketing.featureGrid.card5Title",
      bodyKey: "marketing.featureGrid.card5Body",
      mockup: <MockupTenant />,
    },
    {
      key: "card6",
      titleKey: "marketing.featureGrid.card6Title",
      bodyKey: "marketing.featureGrid.card6Body",
      mockup: <MockupLock />,
    },
  ];

  return (
    <section id="feature-grid">
      <header className="max-w-3xl mx-auto px-6 pt-20 sm:pt-24 text-center tf-fade-up">
        <p className="text-xs font-medium uppercase tracking-wider text-(--color-muted)">
          {t("marketing.featureGrid.eyebrow")}
        </p>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
          {t("marketing.featureGrid.heading")}
        </h2>
        <p className="mt-3 text-sm sm:text-base text-(--color-muted) leading-relaxed">
          {t("marketing.featureGrid.sub")}
        </p>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 tf-stagger">
        {cards.map((c) => (
          <article
            key={c.key}
            className="rounded-2xl border border-(--color-border) bg-(--color-card) p-6 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5 transition-all"
          >
            <BrowserFrame>{c.mockup}</BrowserFrame>
            <h3 className="text-base font-semibold text-(--color-fg) mt-4">
              {t(c.titleKey)}
            </h3>
            <p className="text-sm text-(--color-muted) leading-relaxed mt-1.5">
              {t(c.bodyKey)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
