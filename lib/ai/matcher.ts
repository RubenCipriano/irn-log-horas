import Fuse from "fuse.js";
import type { TodoItem } from "@/types";

export type MatchResult = {
  task: TodoItem;
  score: number; // 1 = perfect, 0 = none
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function matchTasks(query: string, tasks: TodoItem[]): MatchResult[] {
  if (!query.trim() || tasks.length === 0) return [];
  const normalizedQuery = normalize(query);
  const items = tasks.map(t => ({ task: t, normTitle: normalize(t.title) }));

  const fuse = new Fuse(items, {
    keys: ["normTitle"],
    includeScore: true,
    threshold: 0.5,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(normalizedQuery);
  return results.map(r => ({
    task: r.item.task,
    // Fuse returns 0 = perfect; flip to make 1 = best
    score: 1 - (r.score ?? 1),
  }));
}
