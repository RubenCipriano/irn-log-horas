"use client";

import { useState, useCallback } from "react";
import type { WorkSchedule } from "@/types";
import { DEFAULT_SCHEDULE, isSummer, expectedHoursForDate } from "@/lib/work-schedule";
import { readJSON, writeJSON } from "@/lib/storage/localStore";

const STORAGE_KEY = "work_schedule";

export function useWorkSchedule() {
  const [schedule, setSchedule] = useState<WorkSchedule>(() => readJSON<WorkSchedule>(STORAGE_KEY, DEFAULT_SCHEDULE));

  const saveSchedule = useCallback((newSchedule: WorkSchedule) => {
    setSchedule(newSchedule);
    writeJSON(STORAGE_KEY, newSchedule);
  }, []);

  const resetSchedule = useCallback(() => {
    setSchedule(DEFAULT_SCHEDULE);
    writeJSON(STORAGE_KEY, DEFAULT_SCHEDULE);
  }, []);

  const isSummerTime = useCallback((date: Date): boolean => isSummer(date, schedule), [schedule]);

  const getExpectedHours = useCallback((date: Date): number | null => expectedHoursForDate(date, schedule), [schedule]);

  return { schedule, saveSchedule, resetSchedule, isSummerTime, getExpectedHours };
}
