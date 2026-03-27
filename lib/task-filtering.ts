import type { TodoItem } from "@/types";

/**
 * Determines if a task was "active" on a given day based on its status change history.
 * Active means: activeFrom <= dayKey AND (activeUntil is null OR activeUntil >= dayKey)
 */
export function isTaskActiveOnDay(task: TodoItem, dayKey: string): boolean {
  const start = task.activeFrom || null;
  const end = task.activeUntil || null;

  // No activity data: task always available
  if (!start && !end) return true;

  // Has start, no end: active since start (still open)
  if (start && !end) return start <= dayKey;

  // Has end, no start: active until closed
  if (!start && end) return dayKey <= end;

  // Both: active in range [start, end]
  return start! <= dayKey && dayKey <= end!;
}

/**
 * Filter tasks to only those active on a specific day.
 */
export function getActiveTasksForDay(tasks: TodoItem[], dayKey: string): TodoItem[] {
  return tasks.filter(t => isTaskActiveOnDay(t, dayKey));
}
