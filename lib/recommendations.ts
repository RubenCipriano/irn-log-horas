import type { TodoItem, TaskHistory, SmartRecommendation } from "@/types";

type SmartRecommendationParams = {
  tasks: TodoItem[];
  pinnedTaskIds: string[];
  taskHistory: Record<string, TaskHistory>;
  expectedHours: number;
  alreadyRegistered: number;
  meetingsTask: TodoItem | null;
  meetingsTaskId: string;
  dayKey?: string; // for deterministic variation per day
};

// Simple hash for deterministic variation
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function calculateSmartRecommendations({
  tasks,
  pinnedTaskIds,
  taskHistory,
  expectedHours,
  alreadyRegistered,
  meetingsTask,
  meetingsTaskId,
  dayKey,
}: SmartRecommendationParams): SmartRecommendation[] {
  const hoursNeeded = Math.max(0, expectedHours - alreadyRegistered);
  if (hoursNeeded === 0) return [];

  const recommendations: SmartRecommendation[] = [];
  let hoursAssigned = 0;

  // Meetings task (ALWAYS included — fallback with placeholder if fetch failed)
  const meetingsHours = Math.min(0.5, hoursNeeded);
  if (meetingsTask) {
    recommendations.push({
      taskId: meetingsTask.id,
      taskTitle: meetingsTask.title,
      hours: meetingsHours,
      selected: true,
      source: "pinned",
    });
    hoursAssigned += meetingsHours;
  } else if (meetingsTaskId) {
    recommendations.push({
      taskId: meetingsTaskId,
      taskTitle: "Meetings",
      hours: meetingsHours,
      selected: true,
      source: "pinned",
    });
    hoursAssigned += meetingsHours;
  }

  // Score and sort tasks
  const scored = tasks
    .filter(t => t.id !== meetingsTaskId)
    .map(task => {
      const history = taskHistory[task.id];
      const isPinned = pinnedTaskIds.includes(task.id);
      let score = 0;

      if (isPinned) score += 3;

      if (history) {
        const lastUsedDate = new Date(history.lastUsed);
        const daysSinceUsed = Math.floor((Date.now() - lastUsedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceUsed <= 7) score += 2;
        else if (daysSinceUsed <= 30) score += 1;
      }

      return { task, history, isPinned, score };
    })
    .sort((a, b) => b.score - a.score);

  // All tasks are pre-selected (already filtered by sprint upstream)
  // Hours based on history or equal distribution
  const remaining = hoursNeeded - hoursAssigned;
  const tasksWithHistory = scored.filter(s => s.history && s.history.avgHoursPerDay > 0);
  const tasksWithoutHistory = scored.filter(s => !s.history || s.history.avgHoursPerDay === 0);

  // Calculate raw hours from history
  let historyTotal = tasksWithHistory.reduce((sum, s) => sum + s.history!.avgHoursPerDay, 0);
  // Add equal share for tasks without history
  const equalShareForNew = tasksWithoutHistory.length > 0 && tasksWithHistory.length > 0
    ? (historyTotal / tasksWithHistory.length) // give them same avg as history tasks
    : remaining / Math.max(scored.length, 1);

  if (tasksWithoutHistory.length > 0 && tasksWithHistory.length === 0) {
    historyTotal = 0; // all equal
  }

  for (const { task, history, isPinned, score } of scored) {
    const rawHours = history && history.avgHoursPerDay > 0
      ? history.avgHoursPerDay
      : equalShareForNew;
    const source: SmartRecommendation["source"] = isPinned ? "pinned" : score >= 2 ? "history" : "available";

    recommendations.push({
      taskId: task.id,
      taskTitle: task.title,
      hours: Math.max(Math.round(rawHours * 2) / 2, 0.5),
      selected: true, // ALL pre-selected
      source,
    });
  }

  // Scale all task hours to fill remaining hours exactly
  const meetingsId = meetingsTask?.id || meetingsTaskId;
  const nonMeetingsRecs = recommendations.filter(r => r.taskId !== meetingsId);
  const rawTotal = nonMeetingsRecs.reduce((sum, r) => sum + r.hours, 0);

  if (rawTotal > 0 && remaining > 0) {
    const scale = remaining / rawTotal;
    const seed = dayKey ? hashStr(dayKey) : 0;
    for (let i = 0; i < nonMeetingsRecs.length; i++) {
      const rec = nonMeetingsRecs[i];
      let scaled = rec.hours * scale;
      // Add deterministic variation ±0.5h per task (based on day + task index)
      if (dayKey && nonMeetingsRecs.length > 1) {
        const variation = (((seed + i * 7) % 3) - 1) * 0.5;
        scaled += variation;
      }
      rec.hours = Math.max(Math.round(scaled * 2) / 2, 0.5);
    }
    // Fix rounding: iteratively adjust 0.5h at a time until total matches remaining
    let currentTotal = nonMeetingsRecs.reduce((sum, r) => sum + r.hours, 0);
    let gap = Math.round((remaining - currentTotal) * 2) / 2;
    while (gap !== 0) {
      // Sort: reduce from largest tasks, increase on smallest
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

    // If still over budget (too many tasks at minimum 0.5h), deselect lowest-scored tasks
    currentTotal = nonMeetingsRecs.filter(r => r.selected).reduce((sum, r) => sum + r.hours, 0);
    if (currentTotal > remaining) {
      // Deselect from lowest score first (end of array, since scored was sorted desc)
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
