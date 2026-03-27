import type { TodoItem, Holiday } from "@/types";
import type { HoursStatus } from "@/lib/calendar-utils";
import { getHoursStatusColor } from "@/lib/calendar-utils";

type DayCellProps = {
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  holiday?: Holiday;
  todos: TodoItem[];
  hoursStatus: HoursStatus;
  hasHours?: boolean;
  isInSprint?: boolean;
  isSaving?: boolean;
  onClick: () => void;
  onTodoClick: (todo: TodoItem) => void;
  onClearDay?: () => void;
};

export default function DayCell({
  dayNumber,
  isCurrentMonth,
  isToday,
  holiday,
  todos,
  hoursStatus,
  hasHours,
  isInSprint,
  isSaving,
  onClick,
  onTodoClick,
  onClearDay,
}: DayCellProps) {
  const dayBgColor = getHoursStatusColor(hoursStatus);
  const ringClass = isToday
    ? "ring-2 ring-indigo-400"
    : isInSprint
    ? "ring-1 ring-white dark:ring-slate-400"
    : "";

  return (
    <div
      onClick={isSaving ? undefined : onClick}
      className={`group relative flex min-h-20 flex-col rounded-xl border p-2 text-left text-sm transition ${isSaving ? "cursor-wait" : "cursor-pointer"} ${
        isCurrentMonth
          ? `${dayBgColor} text-slate-900 dark:text-slate-100`
          : "border-transparent bg-transparent text-slate-400"
      } ${ringClass}`}
    >
      {isSaving && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/50 dark:bg-slate-900/50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      )}
      {hasHours && onClearDay && (
        <button
          onClick={(e) => { e.stopPropagation(); onClearDay(); }}
          className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs hover:bg-red-600 transition"
          title="Limpar horas deste dia"
        >
          x
        </button>
      )}
      <span className="text-xs font-semibold">
        {isCurrentMonth ? dayNumber : ""}
      </span>
      {holiday && (
        <span className="mt-2 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
          {holiday.name}
        </span>
      )}
      {todos.length > 0 && (
        <div className="mt-2 space-y-1">
          {todos.map((todo) => (
            <button
              key={todo.id}
              onClick={(e) => {
                e.stopPropagation();
                onTodoClick(todo);
              }}
              className="block w-full rounded-md bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900 truncate text-left"
            >
              {todo.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
