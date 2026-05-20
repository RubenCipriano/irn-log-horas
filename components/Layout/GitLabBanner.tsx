"use client";

type Props = {
  commits: number;
  mrs: number;
  onReview: () => void;
  onDismiss: () => void;
};

// Phase 12 — proactive GitLab chip rendered in the TopBar when there is
// activity today. Click "Revisar com IA" pre-fills the command palette;
// click × to dismiss for the day.
export default function GitLabBanner({ commits, mrs, onReview, onDismiss }: Props) {
  const label = [
    commits > 0 ? `${commits} commit${commits === 1 ? "" : "s"}` : null,
    mrs > 0 ? `${mrs} MR${mrs === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 pl-2 pr-1 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
      <span className="h-2 w-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse" aria-hidden />
      <span className="truncate">{label} hoje</span>
      <button
        onClick={onReview}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
        title="Abrir o assistente IA com a actividade de hoje"
      >
        Revisar
      </button>
      <button
        onClick={onDismiss}
        title="Dispensar ate amanha"
        className="rounded p-0.5 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
