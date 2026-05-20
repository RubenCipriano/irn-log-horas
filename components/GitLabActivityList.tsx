"use client";

import type { GitLabActivity } from "@/types";

type Props = {
  activities: GitLabActivity[];
  // Optional: highlight which refIds resolved to a task vs not (not required).
  emptyLabel?: string;
};

function timeOf(iso: string): string {
  const t = (iso.split("T")[1] || "").slice(0, 5);
  return t || "--:--";
}

// Shared renderer for a list of GitLab commits/MRs. Used by both the AI preview
// modal and the calendar day-detail modal so they look identical.
export default function GitLabActivityList({ activities, emptyLabel = "Sem atividade GitLab." }: Props) {
  if (activities.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400 italic py-2">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1">
      {activities.map((a, i) => {
        const isMr = a.type === "merge_request";
        return (
          <li
            key={`${a.url}-${i}`}
            className="flex items-start gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
          >
            <span
              className={`shrink-0 mt-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                isMr
                  ? "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                  : "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"
              }`}
            >
              {isMr ? "MR" : "commit"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 dark:text-slate-100 truncate">{a.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">{timeOf(a.createdAt)}</span>
                {a.refIds.length > 0 && <span>· #{a.refIds.join(", #")}</span>}
                {a.project && <span className="truncate">· {a.project}</span>}
              </div>
            </div>
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-slate-400 hover:text-indigo-500 transition"
                title="Abrir no GitLab"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3h7v7M13 3L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
