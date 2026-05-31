"use client";

// Generic "Phase N — not yet built" view used by every authed route that
// hasn't been ported yet. The `phase` prop sets reader expectations; the
// `next` array hints at what will land in that phase.

export function PlaceholderView({
  title,
  phase,
  blurb,
  next,
}: {
  title: string;
  phase: number;
  blurb: string;
  next?: string[];
}) {
  return (
    <div className="p-6">
      <div className="max-w-2xl space-y-4 tf-fade-up">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-(--color-border) bg-(--color-card) px-2.5 py-0.5 text-[11px] font-medium text-(--color-muted)">
            Phase {phase}
          </span>
          <span className="inline-flex items-center rounded-full border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
            Not yet built
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-(--color-fg)">{title}</h2>
        <p className="text-sm text-(--color-muted) leading-relaxed">{blurb}</p>
        {next && next.length > 0 && (
          <div className="rounded-xl border border-(--color-border) bg-(--color-card) p-4">
            <p className="text-xs font-medium text-(--color-fg) mb-2">What lands in Phase {phase}:</p>
            <ul className="space-y-1.5 text-xs text-(--color-muted)">
              {next.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-indigo-500 shrink-0">›</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
