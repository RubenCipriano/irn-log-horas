import type { TodoItem, SmartRecommendation, TaskStatusTimeline, StatusWeightConfig } from "@/types";
import { DEFAULT_STATUS_WEIGHTS, getStatusWeightForDay } from "@/lib/status-timeline";

// Activity-based recommendation engine. Signals (in order of strength):
//   - status timeline weight for the day (the task's state on that calendar day)
//   - pinned task assignment
// Past-history-based prediction was removed because it produced stale / wrong
// suggestions when sprints rotated. Recommendations now reflect ONLY what the
// tasks were doing on the specific day.
type SmartRecommendationParams = {
  tasks: TodoItem[];
  pinnedTaskIds: string[];
  expectedHours: number;
  alreadyRegistered: number;
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  meetingsHours?: number;
  dayKey?: string;
  timelines?: Record<string, TaskStatusTimeline>;
  statusWeights?: StatusWeightConfig;
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function calculateSmartRecommendations({
  tasks,
  pinnedTaskIds,
  expectedHours,
  alreadyRegistered,
  meetingsTask,
  meetingsTaskId,
  meetingsHours = 0.5,
  dayKey,
  timelines = {},
  statusWeights = DEFAULT_STATUS_WEIGHTS,
}: SmartRecommendationParams): SmartRecommendation[] {
  const hoursNeeded = Math.max(0, expectedHours - alreadyRegistered);
  if (hoursNeeded === 0) return [];

  const recommendations: SmartRecommendation[] = [];
  let hoursAssigned = 0;

  // Meetings task is always included with the user-configured amount (default 0.5h),
  // capped to whatever's actually needed for the day so we never propose more than the budget.
  const meetingsAllocation = Math.min(meetingsHours, hoursNeeded);
  if (meetingsAllocation > 0 && meetingsTask) {
    recommendations.push({
      taskId: meetingsTask.id,
      taskTitle: meetingsTask.title,
      hours: meetingsAllocation,
      selected: true,
      source: "pinned",
    });
    hoursAssigned += meetingsAllocation;
  } else if (meetingsAllocation > 0 && meetingsTaskId) {
    recommendations.push({
      taskId: meetingsTaskId,
      taskTitle: "Meetings",
      hours: meetingsAllocation,
      selected: true,
      source: "pinned",
    });
    hoursAssigned += meetingsAllocation;
  }

  // Score tasks using activity timeline + pinned signal only (no past-hours history).
  const scored = tasks
    .filter(t => t.id !== meetingsTaskId)
    .map(task => {
      const isPinned = pinnedTaskIds.includes(task.id);
      const timeline = timelines[task.id];
      const dayWeight = dayKey && timeline
        ? getStatusWeightForDay(timeline, dayKey, statusWeights)
        : 0.5;

      let score = 0;
      if (isPinned) score += 3;
      if (timeline) {
        if (dayWeight >= 0.5) score += 4;
        else if (dayWeight >= 0.1) score += 2;
        else if (dayWeight === 0) score -= 5;
      }
      return { task, isPinned, score, dayWeight };
    })
    .filter(s => s.score > -5) // drop terminal/blocked
    .sort((a, b) => b.score - a.score);

  // Distribute remaining hours evenly across scored tasks, scaled by day weight.
  const remaining = hoursNeeded - hoursAssigned;
  const equalShare = remaining / Math.max(scored.length, 1);

  for (const { task, isPinned, dayWeight } of scored) {
    const rawHours = equalShare * Math.max(dayWeight, 0.2);
    const source: SmartRecommendation["source"] = dayWeight >= 0.5 && timelines[task.id]
      ? "activity"
      : isPinned
        ? "pinned"
        : "available";

    recommendations.push({
      taskId: task.id,
      taskTitle: task.title,
      hours: Math.max(Math.round(rawHours * 2) / 2, 0.5),
      selected: true,
      source,
    });
  }

  // Scale all task hours to fill remaining hours exactly (preserves daily budget).
  const meetingsId = meetingsTask?.id || meetingsTaskId;
  const nonMeetingsRecs = recommendations.filter(r => r.taskId !== meetingsId);
  const rawTotal = nonMeetingsRecs.reduce((sum, r) => sum + r.hours, 0);

  if (rawTotal > 0 && remaining > 0) {
    const scale = remaining / rawTotal;
    const seed = dayKey ? hashStr(dayKey) : 0;
    for (let i = 0; i < nonMeetingsRecs.length; i++) {
      const rec = nonMeetingsRecs[i];
      let scaled = rec.hours * scale;
      if (dayKey && nonMeetingsRecs.length > 1) {
        const variation = (((seed + i * 7) % 3) - 1) * 0.5;
        scaled += variation;
      }
      rec.hours = Math.max(Math.round(scaled * 2) / 2, 0.5);
    }

    // Iterative gap-fix: 0.5h at a time until daily total matches remaining exactly.
    let currentTotal = nonMeetingsRecs.reduce((sum, r) => sum + r.hours, 0);
    let gap = Math.round((remaining - currentTotal) * 2) / 2;
    while (gap !== 0) {
      const sorted = [...nonMeetingsRecs].sort((a, b) => gap > 0 ? a.hours - b.hours : b.hours - a.hours);
      let adjusted = false;
      for (const rec of sorted) {
        const newHours = rec.hours + (gap > 0 ? 0.5 : -0.5);
        if (newHours >= 0.5) {
          rec.hours = newHours;
          adjusted = true;
          break;
        }
      }
      if (!adjusted) break;
      currentTotal = nonMeetingsRecs.reduce((sum, r) => sum + r.hours, 0);
      gap = Math.round((remaining - currentTotal) * 2) / 2;
    }

    // If still over budget, deselect lowest-scored tasks
    currentTotal = nonMeetingsRecs.filter(r => r.selected).reduce((sum, r) => sum + r.hours, 0);
    if (currentTotal > remaining) {
      const selectedNonMeetings = nonMeetingsRecs.filter(r => r.selected);
      for (let i = selectedNonMeetings.length - 1; i >= 0; i--) {
        if (currentTotal <= remaining) break;
        currentTotal -= selectedNonMeetings[i].hours;
        selectedNonMeetings[i].selected = false;
        selectedNonMeetings[i].hours = 0;
      }
    }
  }

  return recommendations;
}
