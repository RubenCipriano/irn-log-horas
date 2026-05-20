import type { WorkSchedule } from "@/types";

export const DEFAULT_SCHEDULE: WorkSchedule = {
  summer: { monThu: 7, fri: 9 },
  winter: { monThu: 9, fri: 7 },
  summerMonths: [3, 9], // April (index 3) through August (index 8), i.e. [3, 9)
};

export function isSummer(date: Date, schedule: WorkSchedule): boolean {
  const month = date.getMonth();
  return month >= schedule.summerMonths[0] && month < schedule.summerMonths[1];
}

// Expected hours for a Date. Returns null on weekends (UI distinguishes "no
// expectation" from "0 hours expected").
export function expectedHoursForDate(date: Date, schedule: WorkSchedule): number | null {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return null;
  const season = isSummer(date, schedule) ? schedule.summer : schedule.winter;
  return dow >= 1 && dow <= 4 ? season.monThu : season.fri;
}

// Expected hours for a "YYYY-MM-DD" key. Returns 0 on weekends (the AI
// orchestrator treats weekend totals as zero rather than null).
export function expectedHoursForDayKey(dayKey: string, schedule: WorkSchedule): number {
  return expectedHoursForDate(new Date(dayKey + "T00:00:00"), schedule) ?? 0;
}
