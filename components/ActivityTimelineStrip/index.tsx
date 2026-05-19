"use client";

import { useMemo } from "react";
import type { TaskStatusTimeline, StatusWeightConfig } from "@/types";
import { resolveStatusWeight } from "@/lib/status-timeline";

type Props = {
  timeline: TaskStatusTimeline;
  weights: StatusWeightConfig;
  // Optional bounds — by default uses the timeline's own from/to
  from?: string;
  to?: string;
  // Called when the user clicks an inferred segment (so the AI palette can ask)
  onInferredClick?: (segment: { status: string; fromDate: string; toDate: string | null }) => void;
};

function colorForWeight(w: number): string {
  if (w >= 0.8) return "bg-emerald-500";
  if (w >= 0.4) return "bg-amber-500";
  if (w > 0) return "bg-orange-400";
  return "bg-slate-300 dark:bg-slate-700";
}

function formatDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}

export default function ActivityTimelineStrip({ timeline, weights, from, to, onInferredClick }: Props) {
  const todayKey = new Date().toISOString().slice(0, 10);

  const segments = useMemo(() => {
    if (!timeline.segments.length) return [];
    const first = timeline.segments[0].fromDate;
    const last = timeline.segments[timeline.segments.length - 1].toDate ?? todayKey;
    const start = from ?? first;
    const end = to ?? last;
    const total = Math.max(1, daysBetween(start, end));
    return timeline.segments.map(seg => {
      const segStart = seg.fromDate < start ? start : seg.fromDate;
      const segEnd = seg.toDate ?? todayKey;
      const clampedEnd = segEnd > end ? end : segEnd;
      const widthPct = (daysBetween(segStart, clampedEnd) + 1) / total * 100;
      const weight = resolveStatusWeight(seg.statusLower, weights);
      return {
        ...seg,
        widthPct,
        weight,
        rangeLabel: `${formatDate(segStart)} → ${formatDate(clampedEnd)}`,
        inferred: seg.inferred === true,
      };
    }).filter(s => s.widthPct > 0);
  }, [timeline, weights, from, to, todayKey]);

  if (segments.length === 0) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Sem historico de estados disponivel.
      </div>
    );
  }

  const firstDate = from ?? timeline.segments[0].fromDate;
  const lastDate = to ?? timeline.segments[timeline.segments.length - 1].toDate ?? todayKey;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Historico de estados</span>
      </div>
      <div className="flex h-6 w-full overflow-visible rounded-md border border-slate-200 dark:border-slate-700">
        {segments.map((seg, i) => (
          <div
            key={`${seg.statusLower}-${i}`}
            onClick={seg.inferred && onInferredClick
              ? () => onInferredClick({ status: seg.status, fromDate: seg.fromDate, toDate: seg.toDate })
              : undefined}
            className={`${colorForWeight(seg.weight)} relative group transition ${seg.inferred ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
            style={{
              width: `${seg.widthPct}%`,
              ...(seg.inferred ? {
                backgroundImage: "repeating-linear-gradient(45deg, transparent 0, transparent 4px, rgba(255,255,255,0.35) 4px, rgba(255,255,255,0.35) 8px)",
              } : {}),
            }}
          >
            <span className="sr-only">{seg.status}: {seg.rangeLabel}{seg.inferred ? " (inferido)" : ""}</span>
            <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 -translate-y-full z-20 hidden group-hover:block">
              <div className="rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] px-2 py-1.5 shadow-lg whitespace-nowrap">
                <div className="font-semibold capitalize">{seg.status}{seg.inferred && <span className="ml-1 opacity-60 normal-case">(inferido)</span>}</div>
                <div className="opacity-80">{seg.rangeLabel}</div>
                <div className="opacity-60">peso {seg.weight.toFixed(1)}</div>
                {seg.inferred && onInferredClick && (
                  <div className="opacity-80 mt-0.5">clica para confirmar com a IA</div>
                )}
              </div>
              <div className="mx-auto w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900 dark:border-t-slate-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
        <span>{formatDate(firstDate)}</span>
        <span>{formatDate(lastDate)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {segments.map((seg, i) => (
          <div
            key={`legend-${i}`}
            className="flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${colorForWeight(seg.weight)}`} />
            <span className="text-slate-700 dark:text-slate-300 capitalize">{seg.status}</span>
            <span className="text-slate-400 dark:text-slate-500">{seg.rangeLabel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
