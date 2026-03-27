export function formatHours(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}:${mins.toString().padStart(2, "0")}`;
}

export function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && !isNaN(date.getTime());
}

export type HoursStatus = "correct" | "missing" | "wrong" | null;

export function getHoursStatus(
  actualHours: number | undefined,
  expectedHours: number | null
): HoursStatus {
  if (expectedHours === null) return null;
  if (actualHours === undefined) return "missing";
  return actualHours === expectedHours ? "correct" : "wrong";
}

export function getHoursStatusColor(status: HoursStatus): string {
  if (status === "correct") {
    return "border-green-400 dark:border-green-600 bg-green-100 dark:bg-green-800 hover:bg-green-200 dark:hover:bg-green-700";
  } else if (status === "missing") {
    return "border-red-400 dark:border-red-600 bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700";
  } else if (status === "wrong") {
    return "border-yellow-400 dark:border-yellow-600 bg-yellow-100 dark:bg-yellow-800 hover:bg-yellow-200 dark:hover:bg-yellow-700";
  }
  return "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700";
}

export function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function getMonthStartOffset(year: number, monthIndex: number): number {
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}

export const WEEKDAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

export const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function getWeekDays(referenceDate: Date): Date[] {
  const day = referenceDate.getDay();
  const monday = new Date(referenceDate);
  monday.setDate(referenceDate.getDate() - ((day + 6) % 7));
  const days: Date[] = [];
  for (let i = 0; i < 5; i++) { // Mon-Fri
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

// Statuses where hours should be distributed:
// - em desenvolvimento / in progress: actively developing
// - desenvolvido / developed: finished dev, sent to QA
// - novo / new: not started yet, but available for work
// - em teste / testing: in QA
// Excluded: onHold (waiting MR), rejeitado (rejected, no work done)
export const IN_PROGRESS_STATUSES = [
  "em desenvolvimento", "in progress", "development", "in development",
  "desenvolvido", "developed",
  "novo", "new",
  "em teste", "testing",
  "em progresso", "a desenvolver", "em curso", "em execucao",
];
