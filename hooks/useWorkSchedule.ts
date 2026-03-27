"use client";

import { useState, useCallback } from "react";
import type { WorkSchedule } from "@/types";

const DEFAULT_SCHEDULE: WorkSchedule = {
  summer: { monThu: 7, fri: 9 },
  winter: { monThu: 9, fri: 9 },
  summerMonths: [3, 9], // April (index 3) through August (index 8), i.e., [3, 9)
};

const STORAGE_KEY = "work_schedule";

export function useWorkSchedule() {
  const [schedule, setSchedule] = useState<WorkSchedule>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fall through to default
      }
    }
    return DEFAULT_SCHEDULE;
  });

  const saveSchedule = useCallback((newSchedule: WorkSchedule) => {
    setSchedule(newSchedule);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSchedule));
  }, []);

  const resetSchedule = useCallback(() => {
    setSchedule(DEFAULT_SCHEDULE);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SCHEDULE));
  }, []);

  const isSummerTime = useCallback((date: Date): boolean => {
    const month = date.getMonth();
    return month >= schedule.summerMonths[0] && month < schedule.summerMonths[1];
  }, [schedule.summerMonths]);

  const getExpectedHours = useCallback((date: Date): number | null => {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return null; // weekend
    const season = isSummerTime(date) ? schedule.summer : schedule.winter;
    return dayOfWeek >= 1 && dayOfWeek <= 4 ? season.monThu : season.fri;
  }, [schedule, isSummerTime]);

  return { schedule, saveSchedule, resetSchedule, isSummerTime, getExpectedHours };
}
