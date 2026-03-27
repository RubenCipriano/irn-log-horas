"use client";

import { useState, useCallback } from "react";
import type { TaskAssignment } from "@/types";

const STORAGE_KEY = "task_assignments";

type AssignmentsMap = Record<string, TaskAssignment[]>;

function loadAssignments(): AssignmentsMap {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fall through
    }
  }
  return {};
}

function saveAssignments(assignments: AssignmentsMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
}

export function useTaskAssignments() {
  const [assignments, setAssignments] = useState<AssignmentsMap>(loadAssignments);

  const assignTask = useCallback((taskId: string, taskTitle: string, dayKey: string) => {
    setAssignments(prev => {
      const dayAssignments = prev[dayKey] || [];
      if (dayAssignments.some(a => a.taskId === taskId)) return prev;
      const updated = {
        ...prev,
        [dayKey]: [...dayAssignments, { taskId, taskTitle, dayKey }],
      };
      saveAssignments(updated);
      return updated;
    });
  }, []);

  const unassignTask = useCallback((taskId: string, dayKey: string) => {
    setAssignments(prev => {
      const dayAssignments = prev[dayKey] || [];
      const filtered = dayAssignments.filter(a => a.taskId !== taskId);
      const updated = { ...prev, [dayKey]: filtered };
      if (filtered.length === 0) delete updated[dayKey];
      saveAssignments(updated);
      return updated;
    });
  }, []);

  const getAssignmentsForDay = useCallback((dayKey: string): TaskAssignment[] => {
    return assignments[dayKey] || [];
  }, [assignments]);

  const isTaskAssigned = useCallback((taskId: string, dayKey: string): boolean => {
    return (assignments[dayKey] || []).some(a => a.taskId === taskId);
  }, [assignments]);

  return { assignments, assignTask, unassignTask, getAssignmentsForDay, isTaskAssigned };
}
