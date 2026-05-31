// Calendar grid layout helpers. Extracted from CalendarView so both the
// editable monthly grid (CalendarView) and the read-only mini-calendar
// (MemberDetailView) can render identical day cells.

import type { ExpectedHoursDay, HolidayItem, WorklogItem } from "@/lib/types";

export type MonthCell = { iso: string; day: number } | null;

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function iso(d: Date): string {
  // Local date — we don't want UTC shifting Friday to Saturday in PT/UTC+0.
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthDateRange(cursor: Date): { from: string; to: string } {
  const from = iso(cursor);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from, to: iso(lastDay) };
}

export function monthCells(cursor: Date): MonthCell[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  // Monday = 0, Sunday = 6.
  const leading = (first.getDay() + 6) % 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
    cells.push({ iso: iso(date), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function groupByDate(items: WorklogItem[]): Map<string, WorklogItem[]> {
  const m = new Map<string, WorklogItem[]>();
  for (const it of items) {
    const arr = m.get(it.workDate);
    if (arr) arr.push(it); else m.set(it.workDate, [it]);
  }
  return m;
}

export function indexByDate<T extends { date: string }>(items: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(it.date, it);
  return m;
}

export function navBtnClass(): string {
  return "text-sm text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded-md border border-(--color-border) hover:border-indigo-300 transition-colors";
}

export function dayCellClass(
  logged: number,
  expected: number,
  isHoliday: boolean,
  isSelected: boolean,
): string {
  let bg = "bg-(--color-card)";
  if (isHoliday) bg = "bg-rose-50 dark:bg-rose-900/20";
  else if (expected > 0 && logged >= expected) bg = "bg-emerald-50 dark:bg-emerald-900/20";
  else if (expected > 0 && logged > 0) bg = "bg-amber-50 dark:bg-amber-900/20";
  const border = isSelected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-(--color-border) hover:border-indigo-300";
  return `aspect-square rounded-lg border ${border} ${bg} p-1.5 flex flex-col text-left transition-colors`;
}

export type { ExpectedHoursDay, HolidayItem, WorklogItem };
