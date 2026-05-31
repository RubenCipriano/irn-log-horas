"use client";

import { useTranslation } from "react-i18next";
import {
  addMonths,
  dayCellClass,
  monthCells,
  navBtnClass,
  startOfMonth,
} from "@/lib/calendar-grid";
import type { ExpectedHoursDay, HolidayItem, WorklogItem } from "@/lib/types";

// Read-only / interactive monthly grid. Visual contract identical to
// CalendarView's original inline block, so extracting it is a behavioural
// no-op for the calendar page. The mini-calendar on /members/{userId}
// passes readOnly=true; cells become non-interactive divs and the day
// header drops the focus ring.
//
// All datasets pre-indexed by ISO date by the caller. The grid never
// fetches — composition is the parent's job.
export function CalendarMonthGrid({
  cursor,
  onCursorChange,
  logsByDay,
  expectedByDay,
  holidaysByDay,
  selectedIso,
  onSelect,
  readOnly = false,
  monthLabelLocale,
}: {
  cursor: Date;
  onCursorChange: (next: Date) => void;
  logsByDay: Map<string, WorklogItem[]>;
  expectedByDay: Map<string, ExpectedHoursDay>;
  holidaysByDay: Map<string, HolidayItem>;
  selectedIso?: string | null;
  onSelect?: (iso: string) => void;
  readOnly?: boolean;
  // Browser locale used for the month header. Defaults to undefined =>
  // runtime locale. Pass "en-US" / "pt-PT" / "fr-FR" to pin.
  monthLabelLocale?: string;
}) {
  const { t } = useTranslation();
  const cells = monthCells(cursor);
  const monthLabel = cursor.toLocaleString(monthLabelLocale, { month: "long", year: "numeric" });

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-(--color-fg)">{monthLabel}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCursorChange(addMonths(cursor, -1))}
            className={navBtnClass()}
            aria-label={t("memberDetail.month.prev")}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(startOfMonth(new Date()))}
            className={navBtnClass()}
          >
            {t("memberDetail.month.today")}
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(addMonths(cursor, 1))}
            className={navBtnClass()}
            aria-label={t("memberDetail.month.next")}
          >
            →
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-xs text-(--color-muted) px-1">
        {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d) => (
          <div key={d} className="text-center font-medium">
            {t(`common.day.${d}`)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          const key = cell?.iso ?? `pad-${i}`;
          if (!cell) {
            return <div key={key} className="aspect-square rounded-lg bg-transparent" />;
          }
          const dayLogs = logsByDay.get(cell.iso) ?? [];
          const logged = dayLogs.reduce((acc, l) => acc + l.hours, 0);
          const expectedHours = expectedByDay.get(cell.iso)?.hours ?? 0;
          const holiday = holidaysByDay.get(cell.iso);
          const isSelected = !readOnly && selectedIso === cell.iso;
          const className = dayCellClass(logged, expectedHours, !!holiday, isSelected);
          const cellBody = (
            <>
              <div className="flex items-start justify-between">
                <span className="text-sm font-medium">{cell.day}</span>
                {holiday && (
                  <span
                    className="text-[10px] text-rose-500 font-medium"
                    title={holiday.name}
                  >
                    •
                  </span>
                )}
              </div>
              <div className="text-[11px] text-(--color-muted) mt-auto">
                {expectedHours > 0 ? (
                  <span
                    className={
                      logged >= expectedHours
                        ? "text-emerald-600 dark:text-emerald-400"
                        : ""
                    }
                  >
                    {logged}h / {expectedHours}h
                  </span>
                ) : logged > 0 ? (
                  <span>{logged}h</span>
                ) : (
                  <span>–</span>
                )}
              </div>
            </>
          );
          if (readOnly || !onSelect) {
            return (
              <div key={key} className={className} aria-disabled="true">
                {cellBody}
              </div>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(cell.iso)}
              className={className}
            >
              {cellBody}
            </button>
          );
        })}
      </div>
    </section>
  );
}
