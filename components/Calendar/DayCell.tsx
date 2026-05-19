import type { TodoItem, Holiday, TaskStatusTimeline, StatusWeightConfig } from "@/types";
import type { HoursStatus } from "@/lib/calendar-utils";
import { getStatusWeightForDay } from "@/lib/status-timeline";

type DayCellProps = {
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend?: boolean;
  holiday?: Holiday;
  todos: TodoItem[];
  hoursStatus: HoursStatus;
  hasHours?: boolean;
  isInSprint?: boolean;
  isSaving?: boolean;
  dayKey?: string;
  timelines?: Record<string, TaskStatusTimeline>;
  statusWeights?: StatusWeightConfig;
  onClick: () => void;
  onTodoClick: (todo: TodoItem) => void;
  onClearDay?: () => void;
};

function statusColor(s: HoursStatus): { wrap: string; pulse?: string } {
  switch (s) {
    case "correct":
      return { wrap: "border-emerald-300/70 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/40 hover:border-emerald-400 dark:hover:border-emerald-600" };
    case "missing":
      return { wrap: "border-rose-300/70 bg-rose-50 dark:border-rose-700/60 dark:bg-rose-950/40 hover:border-rose-400 dark:hover:border-rose-600" };
    case "wrong":
      return { wrap: "border-amber-300/70 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/40 hover:border-amber-400 dark:hover:border-amber-600" };
    default:
      return { wrap: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600" };
  }
}

function weightPipColor(w: number): string {
  if (w >= 0.8) return "bg-emerald-500";
  if (w >= 0.4) return "bg-amber-400";
  if (w > 0) return "bg-orange-400";
  return "bg-slate-300 dark:bg-slate-600";
}

export default function DayCell({
  dayNumber, isCurrentMonth, isToday, isWeekend, holiday, todos, hoursStatus,
  hasHours, isInSprint, isSaving, dayKey, timelines, statusWeights,
  onClick, onTodoClick, onClearDay,
}: DayCellProps) {
  const colors = statusColor(hoursStatus);
  const ringClass = isToday
    ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-[var(--surface-2)] dark:ring-offset-slate-950"
    : isInSprint
      ? "ring-1 ring-indigo-200 dark:ring-indigo-900"
      : "";

  return (
    <div
      onClick={isSaving ? undefined : onClick}
      className={`group relative flex h-28 flex-col overflow-hidden rounded-xl border p-2 text-left text-sm transition-all duration-200 ${
        isSaving ? "cursor-wait" : "cursor-pointer lift-on-hover"
      } ${isCurrentMonth ? `${colors.wrap} text-slate-900 dark:text-slate-100` : "border-transparent bg-transparent text-slate-300 dark:text-slate-700"} ${ringClass} ${isCurrentMonth && isWeekend && !holiday ? "opacity-60" : ""}`}
      style={isCurrentMonth && isWeekend && !holiday ? { backgroundImage: "repeating-linear-gradient(45deg, transparent 0, transparent 6px, rgba(148,163,184,0.07) 6px, rgba(148,163,184,0.07) 12px)" } : undefined}
    >
      {isSaving && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      )}

      {hasHours && onClearDay && (
        <button
          onClick={(e) => { e.stopPropagation(); onClearDay(); }}
          className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white text-xs hover:bg-rose-600 transition"
          title="Limpar horas deste dia"
        >
          ×
        </button>
      )}

      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${isToday ? "text-indigo-600 dark:text-indigo-400" : ""}`}>
          {isCurrentMonth ? dayNumber : ""}
        </span>
        {isInSprint && isCurrentMonth && (
          <span className="text-[9px] uppercase tracking-wide text-indigo-500 dark:text-indigo-400">sprint</span>
        )}
      </div>

      {holiday && (
        <span className="mt-1.5 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 truncate">
          {holiday.name}
        </span>
      )}

      {todos.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {todos.slice(0, 2).map((todo) => {
            const weight = dayKey && timelines && statusWeights && timelines[todo.id]
              ? getStatusWeightForDay(timelines[todo.id], dayKey, statusWeights)
              : null;
            return (
              <button
                key={todo.id}
                onClick={(e) => { e.stopPropagation(); onTodoClick(todo); }}
                className="flex w-full items-center gap-1.5 rounded-md bg-white/70 dark:bg-slate-900/40 px-1.5 py-1 text-[10px] font-medium text-slate-700 dark:text-slate-300 transition hover:bg-white dark:hover:bg-slate-800 truncate border border-slate-200/60 dark:border-slate-700/50"
              >
                {weight !== null && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${weightPipColor(weight)}`}
                    title={`peso ${weight.toFixed(1)}`}
                  />
                )}
                <span className="truncate">{todo.title}</span>
              </button>
            );
          })}
          {todos.length > 2 && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400">+{todos.length - 2} mais</span>
          )}
        </div>
      )}
    </div>
  );
}
