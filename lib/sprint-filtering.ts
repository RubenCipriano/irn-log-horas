import type { TodoItem, SprintInfo } from "@/types";

// Restrict the task list to a rolling window of sprints: the PREVIOUS, the
// CURRENT, and the NEXT sprint. Tasks belonging to older (or further-future)
// sprints — and tasks with no sprint at all — are dropped, so the app never
// shows stale work packages that have been lingering open for over a month.
//
// "Current" is the latest sprint whose startDate is on/before `today`. The
// window is then [current-1, current, current+1] over the chronological order.

// Sprints with usable startDate, sorted ascending. Undated sprints can't be
// placed in the timeline so they're excluded from the ordering.
function datedSprintsSorted(sprints: SprintInfo[]): SprintInfo[] {
  return sprints
    .filter(s => !!s.startDate)
    .sort((a, b) => (a.startDate as string).localeCompare(b.startDate as string));
}

// Names of the previous + current + next sprint relative to `today`.
// Returns null when the window can't be determined (no dated sprints) — callers
// should then skip filtering rather than wipe the whole list.
export function getSprintWindowNames(sprints: SprintInfo[], today: Date): Set<string> | null {
  const ordered = datedSprintsSorted(sprints);
  if (ordered.length === 0) return null;

  const todayKey = today.toISOString().slice(0, 10);
  // Index of the current sprint: last one that has already started.
  let currentIdx = -1;
  for (let i = 0; i < ordered.length; i++) {
    if ((ordered[i].startDate as string) <= todayKey) currentIdx = i;
  }
  // Today is before every sprint → treat the earliest as current.
  if (currentIdx === -1) currentIdx = 0;

  const window = new Set<string>();
  for (const idx of [currentIdx - 1, currentIdx, currentIdx + 1]) {
    if (idx >= 0 && idx < ordered.length) window.add(ordered[idx].name);
  }
  return window;
}

// Keep only tasks whose sprint is in the previous/current/next window. Tasks
// without a sprint are dropped. If the window can't be resolved (no dated
// sprints), the list is returned untouched so the app never goes empty.
export function filterTasksToSprintWindow(
  tasks: TodoItem[],
  sprints: SprintInfo[],
  today: Date = new Date(),
): TodoItem[] {
  const window = getSprintWindowNames(sprints, today);
  if (!window) return tasks;
  return tasks.filter(t => !!t.sprint && window.has(t.sprint));
}
