import { Section } from "@/components/Section";

const steps = [
  {
    n: 1,
    title: "Plug in your tracker",
    body: "Paste a personal access token (encrypted at rest). We never ask for write scopes beyond posting worklogs.",
  },
  {
    n: 2,
    title: "Describe your week",
    body: "Plain English — 'spent Wednesday on the BFF refactor, Thursday on the regex bug, Friday in meetings'.",
  },
  {
    n: 3,
    title: "Approve the proposal",
    body: "AI shows a per-day, per-task table with reasoning. Tweak the hours, then click Apply. Hours land on the upstream tracker.",
  },
];

export function HowItWorks() {
  return (
    <Section className="bg-(--color-card) border-y border-(--color-border)">
      <header className="text-center max-w-2xl mx-auto mb-14 tf-fade-up">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
          From zero to logged in three steps.
        </h2>
        <p className="mt-3 text-(--color-muted)">
          Each step is reversible, auditable, and respects your existing workflow.
        </p>
      </header>
      <div className="grid sm:grid-cols-3 gap-6 tf-stagger" style={{ ["--tf-stagger-step" as string]: "120ms" }}>
        {steps.map((s, i) => (
          <div
            key={s.n}
            className="relative rounded-2xl border border-(--color-border) bg-(--color-bg) p-6 tf-fade-up"
            style={{ ["--tf-index" as string]: i }}
          >
            <div className="absolute -top-3 -left-3 inline-flex items-center justify-center h-9 w-9 rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white text-sm font-bold shadow-md shadow-indigo-500/30">
              {s.n}
            </div>
            <h3 className="text-base font-semibold text-(--color-fg) mt-2">{s.title}</h3>
            <p className="text-sm text-(--color-muted) leading-relaxed mt-2">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
